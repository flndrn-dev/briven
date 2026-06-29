import { Hono } from 'hono';

import { ValidationError } from '@briven/shared';

import { runInProjectDatabase } from '../db/data-plane.js';
import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { requireProjectAuth, requireProjectRole } from '../middleware/project-auth.js';
import { audit, hashIp } from '../services/audit.js';
import { renderAuthProvisioningSql } from '../services/auth-provisioning.js';
import { getAuthInstance, invalidateAuthInstance } from '../services/auth-tenant-pool.js';
import { listAuditEntries } from '../services/auth-audit.js';
import { getAuthMauStats } from '../services/auth-mau.js';
import {
  importAuthUsers,
  parseImportCsv,
  type ImportRow,
} from '../services/auth-import.js';
import {
  createAuthSdkKey,
  isAssignableSdkKeyScope,
  listAuthSdkKeysForProject,
  revealAuthSdkKey,
  revokeAuthSdkKey,
} from '../services/auth-sdk-keys.js';
import { getProjectUserDetail, listProjectUsers } from '../services/auth-users.js';
import {
  brandingLogoPublicUrl,
  deleteBrandingLogo,
  isStorageConfigured,
  putBrandingLogo,
  validateLogoUpload,
} from '../services/auth-branding-logo.js';
import {
  getAuthConfig,
  isAuthEnabled,
  removeCustomOidcProvider,
  updateAuthConfig,
  upsertCustomOidcProvider,
} from '../services/tenant-config-store.js';
import { hasTenantSecret, setTenantSecret } from '../services/tenant-secrets.js';
import type { ProjectAppEnv as AppEnv } from '../types/app-env.js';

/**
 * OAuth providers whose client secret can be stored via the secret endpoint.
 * google/github/discord/microsoft ride Better Auth's built-in socialProviders;
 * konnos rides the genericOAuth plugin. The per-tenant pool reads these back
 * under the `<provider>_client_secret` name convention (service 'auth').
 */
const OAUTH_PROVIDERS = ['google', 'github', 'discord', 'microsoft', 'konnos'] as const;
type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

function isOAuthProvider(value: string): value is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/**
 * briven auth service router (BUILD_PLAN.md §4).
 *
 * Mounted by `apps/api/src/index.ts` only when `BRIVEN_AUTH_ENABLED=true`.
 * The kill-switch is intentional — if a customer-facing auth bug surfaces
 * in production, an operator can disable the service via Dokploy env
 * without redeploying (ARCHITECTURE.md §9).
 *
 * Three URL prefixes own distinct surfaces:
 *   - `/v1/auth-service/*`  → operational endpoints (health, ready, metrics)
 *   - `/v1/projects/:id/auth/*` → admin endpoints (dashboard-driven; tenant
 *     resolution via path param, project-auth middleware gates access)
 *   - `/v1/auth-tenant/*`   → customer-end-user surface (SDK + hosted pages;
 *     tenant resolution via `x-briven-project-id` header or hosted-pages
 *     subdomain at the edge)
 *
 * Why three prefixes? Control-plane Better Auth already owns `/v1/auth/*`
 * for the briven.tech dashboard login (`apps/api/src/lib/auth.ts`).
 * Customer-tenant Better Auth instances claim `/v1/auth-tenant/*` so the
 * two engines don't collide in Hono routing.
 */
export const authServiceRouter = new Hono<AppEnv>();

// ─── operational ────────────────────────────────────────────────────────

/**
 * Health = process is alive + the service kill-switch is on. Mirrors the
 * shape of `routes/health.ts` so the same monitoring stack scrapes it
 * without bespoke parsing.
 */
authServiceRouter.get('/v1/auth-service/health', (c) =>
  c.json({
    status: 'ok',
    service: 'auth',
    env: env.BRIVEN_ENV,
  }),
);

/**
 * Ready = dependencies reachable. The master key must be configured for
 * per-tenant decrypt; the data plane URL must be configured for per-tenant
 * postgres pools.
 */
authServiceRouter.get('/v1/auth-service/ready', (c) => {
  const masterKeyConfigured = Boolean(process.env.BRIVEN_AUTH_MASTER_KEY);
  const dataPlaneConfigured = Boolean(env.BRIVEN_DATA_PLANE_URL);
  const ready = masterKeyConfigured && dataPlaneConfigured;
  return c.json(
    {
      status: ready ? 'ready' : 'degraded',
      service: 'auth',
      checks: {
        masterKey: masterKeyConfigured ? 'configured' : 'missing',
        dataPlane: dataPlaneConfigured ? 'configured' : 'missing',
      },
    },
    ready ? 200 : 503,
  );
});

// ─── public branding logo (UNAUTHENTICATED) ─────────────────────────────
// Moved to routes/branding-public.ts: it must mount BEFORE the project-auth
// guards (which otherwise return 401) and OUTSIDE the BRIVEN_AUTH_ENABLED kill
// switch, since a hosted login page loads it via a plain <img src>. Same URL.

// ─── admin (dashboard-driven) ───────────────────────────────────────────

authServiceRouter.use('/v1/projects/:id/auth/*', requireProjectAuth());

/**
 * Provision the customer's auth schema. Idempotent — re-running on an
 * already-enabled project is a no-op because every DDL statement uses
 * `IF NOT EXISTS`. Owner / admin tier only (CLAUDE.md §5.4 says admin
 * actions are gated; the auth tables hold session tokens and account
 * data so this is the strictest gate available without 2FA step-up).
 */
authServiceRouter.post(
  '/v1/projects/:id/auth/enable',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }

    const actor = c.get('user');
    if (!actor) {
      // requireProjectAuth would 401 before this — defensive only.
      return c.json({ code: 'unauthorized' }, 401);
    }

    const statements = renderAuthProvisioningSql();
    try {
      await runInProjectDatabase(projectId, async (tx) => {
        for (const stmt of statements) {
          await tx.unsafe(stmt);
        }
        // Flip the meta flag so other code paths can probe "is auth on?"
        // without inspecting pg_tables. DoltGres lacks `ON CONFLICT ... DO
        // UPDATE` (no `excluded` pseudo-table), so emulate the upsert: insert
        // if absent, then unconditionally update. Both run inside the same
        // transaction, so the pair stays atomic and idempotent.
        await tx.unsafe(
          `INSERT INTO "_briven_meta" (key, value)
           VALUES ('auth_enabled', 'true'::jsonb)
           ON CONFLICT (key) DO NOTHING`,
        );
        await tx.unsafe(
          `UPDATE "_briven_meta" SET value = 'true'::jsonb WHERE key = 'auth_enabled'`,
        );
      });
    } catch (err) {
      log.error('briven_auth_enable_failed', {
        projectId,
        message: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        {
          code: 'provisioning_failed',
          message: 'auth provisioning failed; check api logs',
        },
        500,
      );
    }

    const cfIp = c.req.header('cf-connecting-ip') ?? null;
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.enable',
      ipHash: cfIp ? hashIp(cfIp) : null,
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { statements: statements.length },
    });

    log.info('briven_auth_enabled', { projectId, actorId: actor.id });

    return c.json({
      ok: true,
      tables: statements.filter((s) => s.startsWith('CREATE TABLE')).length,
      authUrl: `https://${projectId}.auth.briven.tech`,
      basePath: '/v1/auth-tenant',
    });
  },
);

/**
 * Read the project's current auth config (BUILD_PLAN.md §4 admin endpoint).
 * Returns the validated config blob — secrets are NOT part of this surface;
 * OAuth client secrets live in the encrypted tenant-secret-store and are
 * write-only post first save (BUILD_PLAN.md §6 Providers panel).
 */
authServiceRouter.get(
  '/v1/projects/:id/auth/config',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }
    const [enabled, config] = await Promise.all([
      isAuthEnabled(projectId),
      getAuthConfig(projectId),
    ]);
    return c.json({ enabled, config });
  },
);

/**
 * Patch the project's auth config. Body shape: a partial `AuthConfig`.
 * Server-side merge + zod validation lives in `tenant-config-store.ts`.
 * Bad fields → 400 with zod's issue list; good fields → 200 with the new
 * full config.
 *
 * After every successful write, `invalidateAuthInstance(projectId)` flushes
 * the cached Better Auth instance so the next request rebuilds with the
 * new config (provider toggles, email expiry, sender domain, etc).
 */
authServiceRouter.patch(
  '/v1/projects/:id/auth/config',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);

    const body = await c.req.json().catch(() => null);
    if (body === null) {
      return c.json({ code: 'validation_failed', message: 'body must be JSON' }, 400);
    }

    let next;
    try {
      next = await updateAuthConfig(projectId, body);
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json(
          {
            code: 'validation_failed',
            message: err.message,
            context: (err as ValidationError & { context?: unknown }).context,
          },
          400,
        );
      }
      log.error('briven_auth_config_update_failed', {
        projectId,
        message: err instanceof Error ? err.message : String(err),
      });
      return c.json({ code: 'config_update_failed' }, 500);
    }

    // Drop the cached instance so the very next sign-in / session call
    // rebuilds with the new config. Per ARCHITECTURE.md §3 the eviction
    // path also closes the per-project postgres pool — the freshly
    // created replacement opens a new one.
    await invalidateAuthInstance(projectId);

    const cfIp = c.req.header('cf-connecting-ip') ?? null;
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.config.updated',
      ipHash: cfIp ? hashIp(cfIp) : null,
      userAgent: c.req.header('user-agent') ?? null,
      // Don't log the full patch — provider toggles + branding may include
      // client ids that are public but still noisy. Just count the keys
      // touched so operators can correlate "who patched what when".
      metadata: { keys: Object.keys(body as Record<string, unknown>) },
    });

    return c.json({ config: next });
  },
);

/**
 * Store (or rotate) an OAuth provider's client SECRET. Write-only: the
 * secret is encrypted into the tenant-secret store (service 'auth', name
 * `<provider>_client_secret`) and is NEVER echoed back or logged. The public
 * clientId + enabled toggle live in the auth config (PATCH /auth/config);
 * this endpoint owns only the secret half so the per-tenant Better Auth pool
 * can wire the provider (gated on enabled + clientId + secret-present).
 *
 * After a successful write, `invalidateAuthInstance` drops the cached
 * instance so the next sign-in rebuilds with the new credential.
 */
authServiceRouter.post(
  '/v1/projects/:id/auth/providers/:provider/secret',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const provider = c.req.param('provider');
    if (!projectId || !provider) {
      return c.json(
        { code: 'validation_failed', message: 'missing :id or :provider' },
        400,
      );
    }
    if (!isOAuthProvider(provider)) {
      return c.json(
        {
          code: 'validation_failed',
          message: `provider must be one of: ${OAUTH_PROVIDERS.join(', ')}`,
        },
        400,
      );
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);

    const body = (await c.req.json().catch(() => null)) as
      | { clientSecret?: unknown }
      | null;
    const clientSecret =
      body && typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '';
    if (!clientSecret) {
      return c.json(
        { code: 'validation_failed', message: 'clientSecret must be a non-empty string' },
        400,
      );
    }

    try {
      await setTenantSecret(projectId, 'auth', `${provider}_client_secret`, clientSecret, actor.id);
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ code: 'validation_failed', message: err.message }, 400);
      }
      log.error('briven_auth_provider_secret_set_failed', {
        projectId,
        provider,
        message: err instanceof Error ? err.message : String(err),
      });
      return c.json({ code: 'secret_store_failed' }, 500);
    }

    // Drop the cached instance so the next request rebuilds with the new
    // credential (mirrors the config PATCH path).
    await invalidateAuthInstance(projectId);

    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.provider.secret.set',
      ipHash: hashIp(
        c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
      ),
      userAgent: c.req.header('user-agent') ?? null,
      // why: NEVER log the secret — only which provider was configured.
      metadata: { provider },
    });

    return c.json({ ok: true });
  },
);

/**
 * Which OAuth providers currently have a client secret saved. Boolean-only
 * presence flags (never the secret itself) so the dashboard can show a
 * "secret configured ✓ / needs secret" state next to each provider toggle.
 * Covers the built-in social providers AND every configured custom-OIDC entry
 * (keyed by its slug `id`, secret name `oidc_<id>_client_secret`).
 */
authServiceRouter.get(
  '/v1/projects/:id/auth/providers/secret-status',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }
    const config = await getAuthConfig(projectId);
    const oidcEntries = config.customOidc ?? [];
    const [builtinPresence, oidcPresence] = await Promise.all([
      Promise.all(
        OAUTH_PROVIDERS.map((p) => hasTenantSecret(projectId, 'auth', `${p}_client_secret`)),
      ),
      Promise.all(
        oidcEntries.map((o) =>
          hasTenantSecret(projectId, 'auth', `oidc_${o.id}_client_secret`),
        ),
      ),
    ]);
    const [google, github, discord, microsoft, konnos] = builtinPresence;
    const oidc: Record<string, boolean> = {};
    oidcEntries.forEach((o, i) => {
      oidc[o.id] = oidcPresence[i] ?? false;
    });
    return c.json({ secrets: { google, github, discord, microsoft, konnos }, oidc });
  },
);

// ─── custom OIDC providers (generic OIDC, admin-managed) ─────────────────

/** Slug guard mirroring the `customOidcProviderConfig.id` regex. */
function isOidcSlug(value: string): boolean {
  return /^[a-z0-9-]{1,40}$/.test(value);
}

/**
 * Create or update a custom-OIDC provider (upsert keyed by `id`). Body is a
 * full custom-OIDC entry (id, displayName, enabled, clientId, issuer OR explicit
 * endpoints, scopes?, pkce?). The PUBLIC half only — the client SECRET is set
 * separately via the `/oidc/:oidcId/secret` endpoint (same write-only pattern as
 * the built-in providers). Re-validates server-side; `invalidateAuthInstance`
 * flushes the cached engine so the next request rebuilds with the new provider.
 */
authServiceRouter.post(
  '/v1/projects/:id/auth/providers/oidc',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);

    const body = await c.req.json().catch(() => null);
    if (body === null) {
      return c.json({ code: 'validation_failed', message: 'body must be JSON' }, 400);
    }

    let next;
    try {
      next = await upsertCustomOidcProvider(projectId, body);
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json(
          {
            code: 'validation_failed',
            message: err.message,
            context: (err as ValidationError & { context?: unknown }).context,
          },
          400,
        );
      }
      log.error('briven_auth_oidc_upsert_failed', {
        projectId,
        message: err instanceof Error ? err.message : String(err),
      });
      return c.json({ code: 'config_update_failed' }, 500);
    }

    await invalidateAuthInstance(projectId);
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.provider.oidc.upserted',
      ipHash: hashIp(
        c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
      ),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { oidcId: (body as { id?: unknown }).id ?? null },
    });

    return c.json({ config: next });
  },
);

/**
 * Delete a custom-OIDC provider by slug `id`. Idempotent. Drops the cached
 * engine so the provider stops being offered on the next request. The stored
 * secret is left in place (harmless once the entry is gone).
 */
authServiceRouter.delete(
  '/v1/projects/:id/auth/providers/oidc/:oidcId',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const oidcId = c.req.param('oidcId');
    if (!projectId || !oidcId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :oidcId' }, 400);
    }
    if (!isOidcSlug(oidcId)) {
      return c.json({ code: 'validation_failed', message: 'invalid oidc id' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);

    let next;
    try {
      next = await removeCustomOidcProvider(projectId, oidcId);
    } catch (err) {
      log.error('briven_auth_oidc_delete_failed', {
        projectId,
        oidcId,
        message: err instanceof Error ? err.message : String(err),
      });
      return c.json({ code: 'config_update_failed' }, 500);
    }

    await invalidateAuthInstance(projectId);
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.provider.oidc.deleted',
      ipHash: hashIp(
        c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
      ),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { oidcId },
    });

    return c.json({ config: next });
  },
);

/**
 * Store (or rotate) a custom-OIDC provider's client SECRET. Write-only, encrypted
 * into the tenant-secret store under name `oidc_<id>_client_secret` (service
 * 'auth') — exactly the built-in providers' pattern, just a different name. The
 * value is never echoed or logged. Drops the cached engine on success.
 */
authServiceRouter.post(
  '/v1/projects/:id/auth/providers/oidc/:oidcId/secret',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const oidcId = c.req.param('oidcId');
    if (!projectId || !oidcId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :oidcId' }, 400);
    }
    if (!isOidcSlug(oidcId)) {
      return c.json({ code: 'validation_failed', message: 'invalid oidc id' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);

    const body = (await c.req.json().catch(() => null)) as { clientSecret?: unknown } | null;
    const clientSecret =
      body && typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '';
    if (!clientSecret) {
      return c.json(
        { code: 'validation_failed', message: 'clientSecret must be a non-empty string' },
        400,
      );
    }

    try {
      await setTenantSecret(
        projectId,
        'auth',
        `oidc_${oidcId}_client_secret`,
        clientSecret,
        actor.id,
      );
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ code: 'validation_failed', message: err.message }, 400);
      }
      log.error('briven_auth_oidc_secret_set_failed', {
        projectId,
        oidcId,
        message: err instanceof Error ? err.message : String(err),
      });
      return c.json({ code: 'secret_store_failed' }, 500);
    }

    await invalidateAuthInstance(projectId);
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.provider.oidc.secret.set',
      ipHash: hashIp(
        c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
      ),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { oidcId },
    });

    return c.json({ ok: true });
  },
);

/**
 * Upload (or replace) the branding logo. Multipart form-data, field `file`.
 * Stores the image PRIVATELY in MinIO at a stable key, then points
 * `branding.logoUrl` at the public serve route above (cache-busted). Gated
 * the same way as the branding config PATCH (admin) — it mutates the same
 * branding surface.
 */
authServiceRouter.post(
  '/v1/projects/:id/auth/branding/logo',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    if (!isStorageConfigured()) {
      return c.json({ code: 'storage_not_configured' }, 503);
    }

    let file: File | null = null;
    try {
      const body = await c.req.parseBody();
      const f = body.file;
      if (f instanceof File) file = f;
    } catch {
      return c.json({ code: 'validation_failed', message: 'expected multipart form-data' }, 400);
    }
    if (!file) {
      return c.json({ code: 'validation_failed', message: 'missing `file` form field' }, 400);
    }

    try {
      validateLogoUpload({ contentType: file.type, size: file.size });
      const bytes = new Uint8Array(await file.arrayBuffer());
      await putBrandingLogo({ projectId, bytes, contentType: file.type });
      const logoUrl = brandingLogoPublicUrl(projectId);
      await updateAuthConfig(projectId, { branding: { logoUrl } });
      // Drop the cached Better Auth instance so hosted pages rebuild with
      // the new logo (mirrors the config PATCH path).
      await invalidateAuthInstance(projectId);
      await audit({
        actorId: actor.id,
        projectId,
        action: 'auth.branding.logo.uploaded',
        ipHash: hashIp(
          c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
        ),
        userAgent: c.req.header('user-agent') ?? null,
        metadata: { contentType: file.type, sizeBytes: file.size },
      });
      return c.json({ logoUrl });
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ code: 'validation_failed', message: err.message }, 400);
      }
      log.error('briven_auth_branding_logo_upload_failed', {
        projectId,
        message: err instanceof Error ? err.message : String(err),
      });
      return c.json({ code: 'logo_upload_failed' }, 500);
    }
  },
);

/**
 * Remove the branding logo: delete the object + null out `branding.logoUrl`.
 * Idempotent — a missing object is a no-op. Admin-gated like the upload.
 */
authServiceRouter.delete(
  '/v1/projects/:id/auth/branding/logo',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    if (!isStorageConfigured()) {
      return c.json({ code: 'storage_not_configured' }, 503);
    }

    try {
      await deleteBrandingLogo(projectId);
      await updateAuthConfig(projectId, { branding: { logoUrl: null } });
      await invalidateAuthInstance(projectId);
      await audit({
        actorId: actor.id,
        projectId,
        action: 'auth.branding.logo.removed',
        ipHash: hashIp(
          c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
        ),
        userAgent: c.req.header('user-agent') ?? null,
        metadata: {},
      });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ code: 'validation_failed', message: err.message }, 400);
      }
      log.error('briven_auth_branding_logo_remove_failed', {
        projectId,
        message: err instanceof Error ? err.message : String(err),
      });
      return c.json({ code: 'logo_remove_failed' }, 500);
    }
  },
);

/**
 * Paginated list of users with hard redaction (no email, no IP, no full
 * name). BUILD_PLAN.md §4 admin-list response shape. Cursor pagination
 * for stable order on growing tables.
 *
 * Query params:
 *   ?limit=50            — page size (1..200, default 50)
 *   ?cursor=<opaque>     — next cursor from the previous response
 */
authServiceRouter.get(
  '/v1/projects/:id/auth/users',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }
    const limitRaw = c.req.query('limit');
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const cursor = c.req.query('cursor') ?? null;

    try {
      const result = await listProjectUsers(projectId, {
        limit: Number.isFinite(limit) ? limit : undefined,
        cursor,
      });
      return c.json(result);
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json(
          {
            code: 'validation_failed',
            message: err.message,
          },
          400,
        );
      }
      throw err;
    }
  },
);

/**
 * Single-user detail view: sessions, linked accounts, recent audit. Same
 * redaction rules as the list view — no raw email, no raw IP. Returns
 * 404 when the user id is not present in this project's schema.
 */
authServiceRouter.get(
  '/v1/projects/:id/auth/users/:userId',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    if (!projectId || !userId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :userId' }, 400);
    }
    try {
      const detail = await getProjectUserDetail(projectId, userId);
      if (!detail) return c.json({ code: 'not_found' }, 404);
      return c.json({ user: detail });
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ code: 'validation_failed', message: err.message }, 400);
      }
      throw err;
    }
  },
);

/**
 * Audit log read endpoint. Cursor pagination + optional action / user
 * filters. IP hashes are surfaced as 8-char hints only (CLAUDE.md §5.1).
 */
authServiceRouter.get(
  '/v1/projects/:id/auth/audit-log',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }
    const limitRaw = c.req.query('limit');
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const cursor = c.req.query('cursor') ?? null;
    const action = c.req.query('action') ?? null;
    const userId = c.req.query('userId') ?? null;

    try {
      const result = await listAuditEntries(projectId, {
        limit: Number.isFinite(limit) ? limit : undefined,
        cursor,
        action,
        userId,
      });
      return c.json(result);
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ code: 'validation_failed', message: err.message }, 400);
      }
      throw err;
    }
  },
);

/**
 * Bulk import users. Accepts either:
 *   - content-type: text/csv → parsed via parseImportCsv (header row required;
 *     cols `email,name,emailVerified,passwordHash` in any order)
 *   - content-type: application/json → `{ rows: ImportRow[] }`
 *
 * Hash compat: bcrypt + argon2id accepted (BUILD_PLAN.md §10). Returns
 * per-row errors so a partial CSV can be fixed + retried — the inserts
 * run inside a single tx, so an error short-circuits the whole batch.
 */
authServiceRouter.post(
  '/v1/projects/:id/auth/import',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);

    let rows: ImportRow[] = [];
    const contentType = c.req.header('content-type') ?? '';
    try {
      if (contentType.startsWith('text/csv')) {
        const text = await c.req.text();
        rows = parseImportCsv(text);
      } else {
        const body = (await c.req.json().catch(() => null)) as
          | { rows?: unknown }
          | null;
        if (!body || !Array.isArray(body.rows)) {
          return c.json(
            { code: 'validation_failed', message: 'expected { rows: [...] }' },
            400,
          );
        }
        rows = body.rows as ImportRow[];
      }
    } catch (err) {
      return c.json(
        {
          code: 'validation_failed',
          message: err instanceof Error ? err.message : 'malformed body',
        },
        400,
      );
    }

    try {
      const result = await importAuthUsers(projectId, rows);
      await audit({
        actorId: actor.id,
        projectId,
        action: 'briven_auth.users.imported',
        ipHash: hashIp(
          c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
        ),
        userAgent: c.req.header('user-agent') ?? null,
        metadata: {
          inserted: result.inserted,
          skipped: result.skipped,
          errored: result.errors.length,
        },
      });
      return c.json(result);
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ code: 'validation_failed', message: err.message }, 400);
      }
      throw err;
    }
  },
);

/**
 * Auth MAU + ceiling for the auth → usage panel. Cheap read against
 * `_briven_auth_sessions`; no caching yet — page load frequency is low.
 */
authServiceRouter.get(
  '/v1/projects/:id/auth/mau',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }
    const stats = await getAuthMauStats(projectId);
    return c.json(stats);
  },
);

/**
 * SDK keys — list. Returns masked rows; the plaintext is never persisted
 * after `POST` so it cannot reappear here.
 */
authServiceRouter.get(
  '/v1/projects/:id/auth/api-keys',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }
    const items = await listAuthSdkKeysForProject(projectId);
    return c.json({
      items: items.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        suffix: k.suffix,
        scope: k.scope,
        createdAt: k.createdAt.toISOString(),
        lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
        expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
        revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
      })),
    });
  },
);

/**
 * SDK keys — create. Returns the plaintext exactly once; the caller is
 * responsible for surfacing it to the operator and never persisting it
 * server-side anywhere outside this response.
 */
authServiceRouter.post(
  '/v1/projects/:id/auth/api-keys',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }
    const actor = c.get('user');
    if (!actor) {
      return c.json({ code: 'unauthorized' }, 401);
    }
    const body = (await c.req.json().catch(() => null)) as
      | { name?: unknown; scope?: unknown }
      | null;
    if (!body || typeof body.name !== 'string') {
      return c.json({ code: 'validation_failed', message: 'name required' }, 400);
    }
    const scopeRaw = typeof body.scope === 'string' ? body.scope : 'read';
    if (!isAssignableSdkKeyScope(scopeRaw)) {
      return c.json(
        {
          code: 'validation_failed',
          message: 'scope must be read | read-write | admin',
        },
        400,
      );
    }
    try {
      const created = await createAuthSdkKey({
        projectId,
        createdBy: actor.id,
        name: body.name,
        scope: scopeRaw,
      });
      await audit({
        actorId: actor.id,
        projectId,
        action: 'briven_auth.api_key.created',
        ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
        userAgent: c.req.header('user-agent') ?? null,
        metadata: { keyId: created.record.id, scope: scopeRaw },
      });
      return c.json(
        {
          key: {
            id: created.record.id,
            name: created.record.name,
            prefix: created.record.prefix,
            suffix: created.record.suffix,
            scope: created.record.scope,
            createdAt: created.record.createdAt.toISOString(),
          },
          plaintext: created.plaintext,
        },
        201,
      );
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ code: 'validation_failed', message: err.message }, 400);
      }
      throw err;
    }
  },
);

/**
 * SDK keys — revoke. Idempotent; revoked keys remain in the list with a
 * `revokedAt` timestamp so audit history doesn't lose them.
 */
authServiceRouter.delete(
  '/v1/projects/:id/auth/api-keys/:keyId',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const keyId = c.req.param('keyId');
    if (!projectId || !keyId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :keyId' }, 400);
    }
    const actor = c.get('user');
    if (!actor) {
      return c.json({ code: 'unauthorized' }, 401);
    }
    try {
      await revokeAuthSdkKey(projectId, keyId);
      await audit({
        actorId: actor.id,
        projectId,
        action: 'briven_auth.api_key.revoked',
        ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
        userAgent: c.req.header('user-agent') ?? null,
        metadata: { keyId },
      });
      return c.json({ ok: true });
    } catch (err) {
      if ((err as { code?: string }).code === 'not_found') {
        return c.json({ code: 'not_found' }, 404);
      }
      throw err;
    }
  },
);

/**
 * SDK keys — reveal. Decrypt and return the full plaintext so the owner can
 * copy it again to paste elsewhere. Same authorisation as create/revoke
 * (`requireProjectRole('admin')`) — access is NOT broadened. The plaintext is
 * returned in the JSON body only; it is never logged and the frontend writes
 * it straight to the clipboard without rendering it.
 *
 * A revoked key, or a key created before migration 0039 (no stored
 * ciphertext), returns 404 `key_not_revealable` so the dashboard can tell the
 * owner to rotate. Every successful reveal writes a
 * `briven_auth.api_key.revealed` audit row including the keyId.
 */
authServiceRouter.post(
  '/v1/projects/:id/auth/api-keys/:keyId/reveal',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const keyId = c.req.param('keyId');
    if (!projectId || !keyId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :keyId' }, 400);
    }
    const actor = c.get('user');
    if (!actor) {
      return c.json({ code: 'unauthorized' }, 401);
    }
    try {
      const { plaintext } = await revealAuthSdkKey(projectId, keyId);
      await audit({
        actorId: actor.id,
        projectId,
        action: 'briven_auth.api_key.revealed',
        ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
        userAgent: c.req.header('user-agent') ?? null,
        metadata: { keyId },
      });
      // why: plaintext goes ONLY in this body — never to logs, never re-stored.
      return c.json({ plaintext });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'key_not_revealable') {
        return c.json(
          { code: 'key_not_revealable', message: (err as Error).message },
          404,
        );
      }
      if (code === 'not_found') {
        return c.json({ code: 'not_found' }, 404);
      }
      throw err;
    }
  },
);

// ─── customer-end-user surface (Better Auth handler bridge) ─────────────

/**
 * Tenant resolver. The customer's SDK passes the tenant id via the
 * `x-briven-project-id` header on every request. The hosted-pages
 * deployment resolves the tenant from the subdomain at the edge and
 * sets the same header before forwarding to the api.
 *
 * Missing / malformed header → 400 with a stable error code so the SDK
 * can surface a clear message; the SDK init logs `projectId required`
 * when this fires.
 */
function resolveTenant(c: { req: { header: (k: string) => string | undefined } }): string | null {
  const id = c.req.header('x-briven-project-id');
  if (!id) return null;
  // Same identifier regex as projects.ts — defensive guard so a malformed
  // header can't reach `schemaNameFor()` and produce a bogus schema name.
  if (!/^p_[a-zA-Z0-9_]{6,64}$/.test(id)) return null;
  return id;
}

/**
 * Catch-all bridge. Better Auth ships its own `handler(request)` method
 * that routes every endpoint Better Auth registered (sign-in, sign-up,
 * OAuth callback, magic-link consume, session, etc). We pull the per-
 * tenant instance from the pool, hand the raw Request off, and return
 * Better Auth's Response untouched.
 *
 * Methods covered: GET, POST, PATCH, DELETE, OPTIONS — Better Auth's
 * internal route table includes all of them, so the bridge mounts `.all`.
 */
authServiceRouter.all('/v1/auth-tenant/*', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) {
    return c.json(
      {
        code: 'tenant_unresolved',
        message: 'missing or malformed x-briven-project-id header',
      },
      400,
    );
  }

  try {
    const instance = await getAuthInstance(projectId);
    // `c.req.raw` is the underlying Fetch API Request — Better Auth's
    // handler expects exactly that shape. The Response that comes back
    // already carries Set-Cookie headers, status, body — no rewriting.
    return await instance.betterAuth.handler(c.req.raw);
  } catch (err) {
    log.error('briven_auth_tenant_bridge_failed', {
      projectId,
      path: new URL(c.req.url).pathname,
      message: err instanceof Error ? err.message : String(err),
    });
    return c.json({ code: 'auth_internal_error' }, 500);
  }
});
