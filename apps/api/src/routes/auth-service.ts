import { Hono } from 'hono';

import { ValidationError } from '@briven/shared';

import { runInProjectDatabase } from '../db/data-plane.js';
import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { runWithRequestContext } from '../lib/request-context.js';
import { requireProjectAuth, requireProjectRole } from '../middleware/project-auth.js';
import { audit, hashIp } from '../services/audit.js';
import { renderAuthProvisioningSql } from '../services/auth-provisioning.js';
import { getAuthInstance, invalidateAuthInstance } from '../services/auth-tenant-pool.js';
import { listAuditEntries } from '../services/auth-audit.js';
import { getAuthAnalyticsOverview, getAuthMauStats, getProviderBreakdown } from '../services/auth-mau.js';
import {
  importAuthUsers,
  parseImportCsv,
  type ImportRow,
} from '../services/auth-import.js';
import {
  createAuthSdkKey,
  isAssignableSdkKeyScope,
  listAuthSdkKeysForProject,
  revokeAuthSdkKey,
} from '../services/auth-sdk-keys.js';
import { getProjectUserDetail, listProjectUsers } from '../services/auth-users.js';
import {
  brandingLogoPublicUrl,
  deleteBrandingLogo,
  getBrandingLogo,
  isStorageConfigured,
  putBrandingLogo,
  validateLogoUpload,
} from '../services/auth-branding-logo.js';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { users, projects } from '../db/schema.js';
import { isSuperadminEmail } from '../lib/superadmin.js';
import {
  AppDomainLimitExceeded,
  addOrigin,
  listOrigins,
  removeOrigin,
} from '../services/auth-origin-allowlist.js';
import {
  SOCIAL_PROVIDER_KEYS,
  getAuthConfig,
  isAuthEnabled,
  isSocialProviderKey,
  updateAuthConfig,
} from '../services/tenant-config-store.js';
import { hasTenantSecret, setTenantSecret } from '../services/tenant-secrets.js';
import type { ProjectAppEnv as AppEnv } from '../types/app-env.js';
import {
  acceptInvite,
  addOrgMember,
  createOrg,
  createOrgInvite,
  deleteOrg,
  getInviteByToken,
  getOrg,
  getUserOrgRole,
  listOrgMembers,
  listOrgsForUser,
  listPendingInvites,
  removeOrgMember,
  revokeInvite,
  updateMemberRole,
  updateOrg,
} from '../services/auth-orgs.js';

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

/**
 * Resolve a custom auth domain (e.g. auth.murphus.eu) to a project id.
 * Public and unauthenticated — called by the web-app edge proxy before
 * any auth context exists. Cached aggressively by the caller.
 */
authServiceRouter.get('/v1/auth-service/resolve-domain', async (c) => {
  const domain = c.req.query('domain');
  if (!domain) {
    return c.json({ code: 'validation_failed', message: 'missing domain query param' }, 400);
  }

  const db = getDb();
  const [row] = await db
    .select({ id: projects.id, authDomain: projects.authDomain })
    .from(projects)
    .where(eq(projects.authDomain, domain))
    .limit(1);

  if (!row) {
    return c.json({ code: 'not_found', message: 'no project found for this auth domain' }, 404);
  }

  return c.json({ projectId: row.id, authDomain: row.authDomain });
});

// ─── admin (dashboard-driven) ───────────────────────────────────────────

/**
 * Serve a project's branding logo. World-readable on purpose: hosted login
 * pages (and any embedder) load it via a plain <img src>, so it must work
 * without a session or api key. Registered BEFORE the requireProjectAuth()
 * group middleware below so the auth middleware never runs for this GET.
 * The object stays PRIVATE in MinIO; we proxy the bytes with the stored
 * content-type. nosniff + a locked-down CSP keep a customer SVG image-only.
 */
authServiceRouter.get('/v1/projects/:id/auth/branding/logo', async (c) => {
  const projectId = c.req.param('id');
  if (!projectId) {
    return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
  }
  if (!isStorageConfigured()) {
    return c.json({ code: 'storage_not_configured' }, 503);
  }
  const obj = await getBrandingLogo(projectId);
  if (!obj) {
    return c.json({ code: 'not_found' }, 404);
  }
  return new Response(obj.bytes, {
    status: 200,
    headers: {
      'content-type': obj.contentType,
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
});

authServiceRouter.use('/v1/projects/:id/auth/*', requireProjectAuth());

/**
 * Upload (or replace) the branding logo. Multipart form-data, field `file`.
 * Stores the image PRIVATELY in MinIO at a stable key, then points
 * `branding.logoUrl` at the public serve route above (cache-busted).
 * Admin-gated like the branding config PATCH.
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
    // Surface secret PRESENCE only (booleans) so the UI can render a
    // "secret set ✓" indicator. Never the ciphertext or plaintext —
    // `hasTenantSecret` is a pure existence probe and does not decrypt.
    const presence = await Promise.all(
      SOCIAL_PROVIDER_KEYS.map((key) =>
        hasTenantSecret(projectId, 'auth', `${key}_client_secret`),
      ),
    );
    const secretSet = Object.fromEntries(
      SOCIAL_PROVIDER_KEYS.map((key, i) => [key, presence[i]]),
    ) as Record<(typeof SOCIAL_PROVIDER_KEYS)[number], boolean>;
    return c.json({ enabled, config, secretSet });
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

    // Sync customAuthDomain to the control-plane projects table so the
    // edge proxy can resolve auth.murphus.eu → projectId without querying
    // every tenant database.
    const domainPatch = (body as Record<string, unknown>)?.customAuthDomain;
    if (domainPatch !== undefined) {
      const db = getDb();
      await db
        .update(projects)
        .set({ authDomain: typeof domainPatch === 'string' ? domainPatch : null })
        .where(eq(projects.id, projectId));
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

/** Max accepted client-secret length. Real OAuth secrets are well under this
 * (Google ~24, GitHub ~40, Microsoft ~40); the cap just rejects garbage. */
const MAX_CLIENT_SECRET_LEN = 500;

/**
 * Set (or replace) one built-in social provider's OAuth **client secret**
 * (BUILD_PLAN.md §6 Providers panel). The public client id travels through
 * the plain config PATCH above; the secret travels HERE, into the encrypted
 * tenant-secret store, so it never lands in the config blob or an audit log.
 *
 * Admin-gated exactly like the config PATCH. Write-only by design: the value
 * is never returned by this or any other endpoint — the UI only ever learns
 * presence via `secretSet` on the config GET.
 *
 * On success the cached Better Auth instance is evicted so the next sign-in
 * rebuilds with the now-complete (client id + secret) provider.
 */
authServiceRouter.put(
  '/v1/projects/:id/auth/providers/:provider/secret',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }
    const provider = c.req.param('provider');
    if (!isSocialProviderKey(provider)) {
      return c.json({ code: 'validation_failed', message: 'unknown provider' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);

    const body = (await c.req.json().catch(() => null)) as { secret?: unknown } | null;
    if (body === null) {
      return c.json({ code: 'validation_failed', message: 'body must be JSON' }, 400);
    }
    const secret = body.secret;
    if (typeof secret !== 'string' || secret.length === 0) {
      return c.json(
        { code: 'validation_failed', message: 'secret must be a non-empty string' },
        400,
      );
    }
    if (secret.length > MAX_CLIENT_SECRET_LEN) {
      return c.json(
        { code: 'validation_failed', message: 'secret too long' },
        400,
      );
    }

    await setTenantSecret(projectId, 'auth', `${provider}_client_secret`, secret, actor.id);

    // Evict the cached instance so the next sign-in rebuilds with the
    // freshly-complete provider (client id + secret both present now).
    await invalidateAuthInstance(projectId);

    const cfIp = c.req.header('cf-connecting-ip') ?? null;
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.provider.secret.set',
      ipHash: cfIp ? hashIp(cfIp) : null,
      userAgent: c.req.header('user-agent') ?? null,
      // Record WHICH provider was rotated — NEVER the secret value or length.
      metadata: { provider },
    });

    return c.json({ ok: true });
  },
);

/**
 * Allowed app domains — the browser guest list. Each project registers the
 * origins its own app is served from so briven auth trusts login requests from
 * that site (consumed by the CORS gate + CSRF check + each tenant's Better Auth
 * trustedOrigins). Admin-gated; capped per project unless the caller is the
 * platform founder/superadmin.
 */
authServiceRouter.get(
  '/v1/projects/:id/auth/allowed-domains',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }
    const domains = await listOrigins(projectId);
    return c.json({ domains });
  },
);

authServiceRouter.post(
  '/v1/projects/:id/auth/allowed-domains',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);

    const body = (await c.req.json().catch(() => null)) as
      | { origin?: unknown; isWildcard?: unknown }
      | null;
    const origin = typeof body?.origin === 'string' ? body.origin : '';
    const isWildcard = body?.isWildcard === true;
    if (!origin) {
      return c.json({ code: 'validation_failed', message: 'missing `origin`' }, 400);
    }

    // Founder/superadmin (isAdmin + env allowlist) has no per-project cap.
    const [urow] = await getDb()
      .select({ email: users.email, isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, actor.id))
      .limit(1);
    const unlimited = Boolean(urow?.isAdmin) && isSuperadminEmail(urow?.email);

    try {
      const domain = await addOrigin({ projectId, origin, isWildcard, createdBy: actor.id, unlimited });
      await invalidateAuthInstance(projectId);
      await audit({
        actorId: actor.id,
        projectId,
        action: 'auth.allowed_domain.added',
        ipHash: hashIp(
          c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
        ),
        userAgent: c.req.header('user-agent') ?? null,
        metadata: { origin: domain.origin, isWildcard: domain.isWildcard },
      });
      return c.json({ domain });
    } catch (err) {
      if (err instanceof AppDomainLimitExceeded) {
        return c.json({ code: err.code, message: err.message }, 402);
      }
      if (err instanceof ValidationError) {
        return c.json({ code: 'validation_failed', message: err.message }, 400);
      }
      log.error('briven_auth_allowed_domain_add_failed', {
        projectId,
        message: err instanceof Error ? err.message : String(err),
      });
      return c.json({ code: 'allowed_domain_add_failed' }, 500);
    }
  },
);

authServiceRouter.delete(
  '/v1/projects/:id/auth/allowed-domains/:originId',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const originId = c.req.param('originId');
    if (!projectId || !originId) {
      return c.json({ code: 'validation_failed', message: 'missing :id/:originId' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);

    const removed = await removeOrigin(projectId, originId);
    if (!removed) return c.json({ code: 'not_found' }, 404);
    await invalidateAuthInstance(projectId);
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.allowed_domain.removed',
      ipHash: hashIp(
        c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
      ),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { originId },
    });
    return c.json({ ok: true });
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
 * Auth analytics overview — DAU, new signups, total users, active sessions.
 */
authServiceRouter.get(
  '/v1/projects/:id/auth/analytics/overview',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }
    const overview = await getAuthAnalyticsOverview(projectId);
    return c.json(overview);
  },
);

/**
 * Auth provider breakdown — how users sign in (email, OAuth, passkey, etc).
 */
authServiceRouter.get(
  '/v1/projects/:id/auth/analytics/providers',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }
    const breakdown = await getProviderBreakdown(projectId);
    return c.json(breakdown);
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

// ─── customer-end-user surface (Better Auth handler bridge) ─────────────

/**
 * Tenant resolver. The customer's SDK passes the tenant id via the
 * `x-briven-project-id` header on every request; the hosted-pages
 * deployment resolves the tenant from the subdomain at the edge and
 * sets the same header before forwarding to the api.
 *
 * Fallback: browser-navigation endpoints (magic-link verify, email
 * verification, OAuth callback) arrive as a plain link click that can't
 * carry that header, so we also accept a `briven_project_id` query param
 * (stamped into the link by tagTenantUrl()). Header wins when both exist.
 *
 * Missing / malformed on both → 400 with a stable error code so the SDK
 * can surface a clear message; the SDK init logs `projectId required`
 * when this fires.
 */
function resolveTenant(c: {
  req: { header: (k: string) => string | undefined; url: string };
}): string | null {
  // Same identifier regex as projects.ts — a malformed id must never reach
  // schemaNameFor() and produce a bogus schema name.
  const VALID = /^p_[a-zA-Z0-9_]{6,64}$/;
  // 1. Header — how the SDK (and the hosted-pages edge) pass the tenant on
  //    every programmatic request.
  const header = c.req.header('x-briven-project-id');
  if (header && VALID.test(header)) return header;
  // 2. Query-param fallback — browser-navigation endpoints (magic-link verify,
  //    email verification, OAuth callback) are reached by a plain link click,
  //    which cannot carry a custom header. The tenant id is stamped into the
  //    link by tagTenantUrl() (auth-tenant-pool.ts). `p_…` is a public
  //    identifier; the one-time token in the same URL stays the real credential.
  try {
    const q = new URL(c.req.url).searchParams.get('briven_project_id');
    if (q && VALID.test(q)) return q;
  } catch {
    /* malformed request URL — fall through to unresolved */
  }
  return null;
}

/**
 * Callback/redirect normalization for the tenant-auth bridge.
 *
 * WHY this exists (proven-by-trace bug):
 *   1. The @briven/auth SDK POSTs `{ email, redirectTo }` to endpoints like
 *      /v1/auth-tenant/sign-in/magic-link — but Better Auth only reads
 *      `body.callbackURL`, so `redirectTo` is silently ignored. After the
 *      user clicks the email link, Better Auth redirects to its default "/",
 *      resolved against its baseURL (api.briven.tech) instead of the tenant
 *      app. We seed `callbackURL` from `redirectTo` here so the intent the
 *      SDK expressed actually reaches Better Auth.
 *   2. A RELATIVE callbackURL ("/dashboard") also resolves against
 *      api.briven.tech, not the calling app. The SDK's fetch always carries
 *      an Origin header, so we absolutize relative paths against it
 *      (Origin "https://code.konnos.org" + "/dashboard" →
 *      "https://code.konnos.org/dashboard").
 *
 * Security boundary: we do NOT validate the resulting absolute URL here.
 * Better Auth's trustedOrigins originCheck still validates every absolute
 * callbackURL against the project's registered app domains downstream —
 * that check is the security boundary, and this function must neither
 * bypass nor duplicate it. Protocol-relative "//evil.com" is left alone
 * (it is not a same-app relative path), and a malformed/missing Origin
 * means we forward the body untouched. Never throws.
 */
const TENANT_CALLBACK_FIELDS = ['callbackURL', 'newUserCallbackURL', 'errorCallbackURL'] as const;

export function normalizeTenantCallbacks(
  body: Record<string, unknown>,
  origin: string | null,
): Record<string, unknown> {
  try {
    const out: Record<string, unknown> = { ...body };

    // Bridge the SDK's vocabulary: seed callbackURL (and only callbackURL)
    // from redirectTo when the caller didn't set callbackURL explicitly.
    if (out.callbackURL === undefined && typeof out.redirectTo === 'string') {
      out.callbackURL = out.redirectTo;
    }

    // Absolutize relative paths against the calling app's Origin. Only a
    // valid http(s) origin qualifies; otherwise leave everything untouched.
    let originUrl: URL | null = null;
    if (origin) {
      try {
        const parsed = new URL(origin);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          originUrl = parsed;
        }
      } catch {
        /* malformed Origin header — do not rewrite anything */
      }
    }
    if (originUrl) {
      for (const field of TENANT_CALLBACK_FIELDS) {
        const value = out[field];
        // "/path" is app-relative; "//host" is protocol-relative (a foreign
        // host, not a path) and must be left for originCheck to reject.
        if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) {
          out[field] = new URL(value, originUrl).toString();
        }
      }
    }
    return out;
  } catch {
    // Normalization must never break an auth request.
    return body;
  }
}

/**
 * Rewrites the incoming bridge Request when (and only when) it is a JSON
 * POST to an endpoint that accepts a callbackURL (sign-in/*, sign-up,
 * forget-password, send-verification-email). Everything else — and any
 * body that fails to parse — is forwarded byte-for-byte untouched so a
 * weird payload can never break auth.
 */
async function rewriteTenantCallbackRequest(raw: Request): Promise<Request> {
  try {
    if (raw.method !== 'POST') return raw;
    const path = new URL(raw.url).pathname;
    const eligible =
      path.includes('/sign-in/') ||
      path.includes('/sign-up') ||
      path.includes('/forget-password') ||
      path.includes('/send-verification-email');
    if (!eligible) return raw;
    const contentType = raw.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) return raw;

    // Clone before reading so the original stream stays consumable if we
    // bail out (parse failure, non-object body).
    const parsed: unknown = await raw.clone().json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return raw;

    const normalized = normalizeTenantCallbacks(
      parsed as Record<string, unknown>,
      raw.headers.get('origin'),
    );

    // Preserve method, url, and headers — but drop content-length so the
    // runtime recomputes it for the (possibly longer) mutated body.
    const headers = new Headers(raw.headers);
    headers.delete('content-length');
    return new Request(raw.url, {
      method: raw.method,
      headers,
      body: JSON.stringify(normalized),
    });
  } catch {
    // Any failure → forward the original request exactly as today.
    return raw;
  }
}

// ─── tenant session helper ────────────────────────────────────────────────

/**
 * Resolve the current user id from the tenant session cookie.
 * Makes an internal sub-request to the project's Better Auth instance
 * so the exact same session validation runs (cookie parsing, token
 * verification, expiry checks).
 */
async function getTenantUserId(c: typeof authServiceRouter extends Hono<infer E> ? Parameters<E['Variables']>[0] extends never ? never : any : never, projectId: string): Promise<string | null> {
  try {
    const instance = await getAuthInstance(projectId);
    const url = new URL(c.req.url);
    const sessionReq = new Request(`${url.origin}/v1/auth-tenant/get-session?briven_project_id=${projectId}`, {
      method: 'GET',
      headers: {
        cookie: c.req.header('cookie') ?? '',
        'x-briven-project-id': projectId,
      },
    });
    const response = await instance.betterAuth.handler(sessionReq);
    if (!response.ok) return null;
    const body = (await response.json()) as { user?: { id?: string } } | null;
    return body?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ─── organizations (customer-facing) ─────────────────────────────────────

authServiceRouter.get('/v1/auth-tenant/orgs', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgs = await listOrgsForUser(projectId, userId);
  return c.json({ orgs });
});

authServiceRouter.post('/v1/auth-tenant/orgs', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const body = await c.req.json().catch(() => ({}));
  try {
    const org = await createOrg(projectId, userId, body as { name: string; slug: string; logo?: string });
    return c.json({ org });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
    log.error('org_create_failed', { projectId, message: err instanceof Error ? err.message : String(err) });
    return c.json({ code: 'org_create_failed' }, 500);
  }
});

authServiceRouter.get('/v1/auth-tenant/orgs/:id', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const org = await getOrg(projectId, c.req.param('id'));
  if (!org) return c.json({ code: 'not_found' }, 404);
  return c.json({ org });
});

authServiceRouter.patch('/v1/auth-tenant/orgs/:id', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  const role = await getUserOrgRole(projectId, orgId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return c.json({ code: 'forbidden', message: 'only owner or admin can update org' }, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  try {
    const org = await updateOrg(projectId, orgId, body as { name?: string; logo?: string | null; slug?: string });
    return c.json({ org });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
    return c.json({ code: 'org_update_failed' }, 500);
  }
});

authServiceRouter.delete('/v1/auth-tenant/orgs/:id', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  const role = await getUserOrgRole(projectId, orgId, userId);
  if (role !== 'owner') return c.json({ code: 'forbidden', message: 'only owner can delete org' }, 403);
  await deleteOrg(projectId, orgId);
  return c.json({ ok: true });
});

// members
authServiceRouter.get('/v1/auth-tenant/orgs/:id/members', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  const members = await listOrgMembers(projectId, orgId);
  return c.json({ members });
});

authServiceRouter.post('/v1/auth-tenant/orgs/:id/members', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  const role = await getUserOrgRole(projectId, orgId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return c.json({ code: 'forbidden', message: 'only owner or admin can add members' }, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  try {
    const member = await addOrgMember(projectId, orgId, body.userId, body.role ?? 'member');
    return c.json({ member });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
    return c.json({ code: 'member_add_failed' }, 500);
  }
});

authServiceRouter.patch('/v1/auth-tenant/orgs/:id/members/:userId', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  const role = await getUserOrgRole(projectId, orgId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return c.json({ code: 'forbidden', message: 'only owner or admin can update roles' }, 403);
  }
  const targetUserId = c.req.param('userId');
  const body = await c.req.json().catch(() => ({}));
  try {
    const member = await updateMemberRole(projectId, orgId, targetUserId, body.role);
    return c.json({ member });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
    return c.json({ code: 'member_update_failed' }, 500);
  }
});

authServiceRouter.delete('/v1/auth-tenant/orgs/:id/members/:userId', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  const role = await getUserOrgRole(projectId, orgId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return c.json({ code: 'forbidden', message: 'only owner or admin can remove members' }, 403);
  }
  await removeOrgMember(projectId, orgId, c.req.param('userId'));
  return c.json({ ok: true });
});

// invites
authServiceRouter.get('/v1/auth-tenant/orgs/:id/invites', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  const role = await getUserOrgRole(projectId, orgId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return c.json({ code: 'forbidden', message: 'only owner or admin can view invites' }, 403);
  }
  const invites = await listPendingInvites(projectId, orgId);
  return c.json({ invites });
});

authServiceRouter.post('/v1/auth-tenant/orgs/:id/invites', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  const role = await getUserOrgRole(projectId, orgId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return c.json({ code: 'forbidden', message: 'only owner or admin can invite' }, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  try {
    const invite = await createOrgInvite(projectId, orgId, userId, { email: body.email, role: body.role });
    return c.json({ invite });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
    return c.json({ code: 'invite_create_failed' }, 500);
  }
});

authServiceRouter.delete('/v1/auth-tenant/orgs/:id/invites/:inviteId', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  const role = await getUserOrgRole(projectId, orgId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return c.json({ code: 'forbidden', message: 'only owner or admin can revoke invites' }, 403);
  }
  await revokeInvite(projectId, c.req.param('inviteId'));
  return c.json({ ok: true });
});

authServiceRouter.get('/v1/auth-tenant/invites/:token', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const invite = await getInviteByToken(projectId, c.req.param('token'));
  if (!invite) return c.json({ code: 'not_found' }, 404);
  return c.json({ invite });
});

authServiceRouter.post('/v1/auth-tenant/invites/accept', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const body = await c.req.json().catch(() => ({}));
  try {
    const result = await acceptInvite(projectId, body.token, userId);
    return c.json({ ok: true, orgId: result.orgId });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
    return c.json({ code: 'invite_accept_failed' }, 500);
  }
});

// ─── Catch-all bridge ─────────────────────────────────────────────────────

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
        message:
          'missing or malformed tenant id (x-briven-project-id header or briven_project_id query param)',
      },
      400,
    );
  }

  // Raw visitor IP for the control-plane sign-up geo capture. Better Auth's
  // user.create hook can't read the HTTP request, so we stash the IP in an
  // AsyncLocalStorage context around the handler call; the hook reads it back
  // via getRequestContext(). Take the first comma-separated x-forwarded-for
  // value (the original client, before proxy appends). Independent of Better
  // Auth's own disableIpTracking — this is control-plane analytics only.
  const ip =
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;

  try {
    const instance = await getAuthInstance(projectId);
    // `c.req.raw` is the underlying Fetch API Request — Better Auth's
    // handler expects exactly that shape. The Response that comes back
    // already carries Set-Cookie headers, status, body — no rewriting.
    // rewriteTenantCallbackRequest() only touches JSON POSTs to the
    // callback-carrying endpoints (see its doc comment); everything else
    // passes through as the untouched raw Request.
    const request = await rewriteTenantCallbackRequest(c.req.raw);
    const response = await runWithRequestContext({ ip, projectId }, () =>
      instance.betterAuth.handler(request),
    );
    return await withActionableOriginError(response, projectId);
  } catch (err) {
    log.error('briven_auth_tenant_bridge_failed', {
      projectId,
      path: new URL(c.req.url).pathname,
      message: err instanceof Error ? err.message : String(err),
    });
    return c.json({ code: 'auth_internal_error' }, 500);
  }
});

/**
 * Turn Better Auth's raw `INVALID_ORIGIN` into an actionable error that
 * tells the developer exactly what to configure. We only inspect JSON error
 * responses; success responses and non-JSON bodies pass through untouched.
 */
async function withActionableOriginError(
  response: Response,
  projectId: string,
): Promise<Response> {
  // Only intercept 4xx JSON errors. Better Auth uses 400 for INVALID_ORIGIN.
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return response;
  }
  if (response.status < 400 || response.status >= 500) {
    return response;
  }

  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  const isInvalidOrigin =
    body &&
    typeof body === 'object' &&
    ('INVALID_ORIGIN' === (body as { code?: string }).code ||
      'INVALID_ORIGIN' === (body as { error?: { code?: string } }).error?.code ||
      ((body as { message?: string }).message?.toUpperCase().includes('INVALID_ORIGIN') ??
        false));

  if (!isInvalidOrigin) return response;

  const actionable = {
    code: 'INVALID_ORIGIN',
    message: `This app origin is not allowed for project ${projectId}. Add it in the Briven dashboard → Auth → Allowed Domains, or via POST /v1/projects/${projectId}/auth/allowed-domains.`,
    docs: 'https://docs.briven.tech/auth/allowed-domains',
  };

  const jsonBody = JSON.stringify(actionable);
  const headers = new Headers(response.headers);
  headers.set('content-length', String(Buffer.byteLength(jsonBody)));

  return new Response(jsonBody, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
