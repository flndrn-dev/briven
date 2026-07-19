import { Hono } from 'hono';
import { z } from 'zod';

import { ValidationError } from '@briven/shared';

import { runInProjectDatabase } from '../db/data-plane.js';
import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { runWithRequestContext } from '../lib/request-context.js';
import { requireProjectAuth, requireProjectRole } from '../middleware/project-auth.js';
import { requireAuthTeamAdmin } from '../middleware/auth-team.js';
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
  resolveAuthSdkKey,
  revealAuthSdkKey,
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
  originsForProject,
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
  banUser,
  checkSignUpGate,
  listWaitlist,
  approveWaitlistEntry,
  rejectWaitlistEntry,
  suspendUser,
  unbanUser,
  unsuspendUser,
} from '../services/auth-security.js';
import { checkIpRateLimit, checkEmailRateLimit } from '../services/auth-rate-limit.js';
import { checkPasswordBreach } from '../services/auth-breach-detection.js';
import { verifyTurnstileToken } from '../services/auth-turnstile.js';
import {
  getUserMetadata,
  getUserPublicMetadata,
  setUserMetadata,
  deleteUserMetadata,
} from '../services/auth-user-metadata.js';
import {
  listUserEmails,
  addUserEmail,
  verifyUserEmail,
  setPrimaryEmail,
  removeUserEmail,
} from '../services/auth-user-emails.js';
import {
  createSigninToken,
  exchangeSigninToken,
  SigninTokenError,
} from '../services/auth-signin-tokens.js';
import {
  acceptInvite,
  addOrgMember,
  createOrg,
  createOrgInvite,
  deleteOrg,
  getInviteByToken,
  getOrg,
  getSessionActiveOrg,
  getUserOrgRole,
  hasPermission,
  listOrgDomains,
  listOrgMembers,
  listOrgRoles,
  listOrgsForUser,
  listPendingInvites,
  listMembershipRequests,
  addOrgDomain,
  createMembershipRequest,
  createOrgRole,
  deleteOrgRole,
  removeOrgDomain,
  removeOrgMember,
  resolveMembershipRequest,
  revokeInvite,
  setOrgDomainAutoJoin,
  setSessionActiveOrg,
  updateMemberRole,
  updateOrg,
  updateOrgRole,
  verifyOrgDomain,
} from '../services/auth-orgs.js';
import {
  createSsoConnection,
  createSsoSession,
  deleteSsoConnection,
  exchangeOidcCode,
  findConnectionByDomain,
  findOrCreateSsoUser,
  generateOidcAuthUrl,
  generateSamlAuthnRequest,
  generateSamlMetadata,
  getSsoConnection,
  listSsoConnections,
  revokeAllSessionsForConnection,
  updateSsoConnection,
  validateSamlResponse,
} from '../services/auth-sso.js';
import { listUserAccounts, unlinkUserAccount } from '../services/auth-account-linking.js';
import {
  addAuthTeamMember,
  findUserByEmail,
  listAuthTeamMembers,
  removeAuthTeamMember,
} from '../services/auth-team-seats.js';
import {
  createImpersonationSession,
  getActiveImpersonation,
  stopImpersonationSession,
} from '../services/auth-impersonate.js';
import { listAppLogs, purgeOldAppLogs, purgeOldAuditLogs } from '../services/auth-app-logs.js';
import { bulkBanUsers, bulkDeleteUsers, bulkInviteUsers } from '../services/auth-bulk-ops.js';
import { getComplianceSettings, setComplianceSettings } from '../services/auth-compliance.js';
import {
  buildEnterpriseSalesPack,
  signGdprDpa,
  signHipaaBaa,
} from '../services/auth-enterprise-pack.js';
import {
  deleteScimRoleMap,
  listScimRoleMaps,
  upsertScimRoleMap,
} from '../services/auth-scim-role-maps.js';
import {
  createJwtTemplate,
  deleteJwtTemplate,
  generateJwtToken,
  getCustomJwks,
  listJwtTemplates,
} from '../services/auth-jwt-templates.js';
import {
  generateAvatarPresign,
  getAvatarImage,
  updateUserAvatar,
} from '../services/auth-user-avatar.js';
import {
  createUsername,
  deleteUsername,
  getUsernameByUserId,
  resolveUsernameToEmail,
  validateUsername,
} from '../services/auth-usernames.js';
import {
  createTestToken,
  exchangeTestToken,
  listTestTokens,
  revokeTestToken,
} from '../services/auth-test-tokens.js';
import {
  deactivateEmailTemplate,
  listEmailTemplates,
  setEmailTemplate,
  type EmailTemplateName,
  EMAIL_TEMPLATE_NAMES,
} from '../services/auth-email-templates.js';
import {
  assertPasswordNotReused,
  forcePasswordReset,
  getPasswordPolicy,
  setPasswordPolicy,
  validatePassword,
} from '../services/auth-password-policy.js';
import { exportUserData } from '../services/auth-gdpr-export.js';

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
authServiceRouter.use('/v1/projects/:id/auth/*', requireAuthTeamAdmin());

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

// ─── Account linking (Gap Fix #4) ─────────────────────────────────────────

authServiceRouter.get(
  '/v1/projects/:id/auth/users/:userId/accounts',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    if (!projectId || !userId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :userId' }, 400);
    }
    const accounts = await listUserAccounts(projectId, userId);
    return c.json({ accounts });
  },
);

/**
 * Admin unlink one linked account (OAuth / credential row) from a user.
 * Refuses to remove the only remaining sign-in method.
 */
authServiceRouter.delete(
  '/v1/projects/:id/auth/users/:userId/accounts/:accountId',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    const accountId = c.req.param('accountId');
    if (!projectId || !userId || !accountId) {
      return c.json({ code: 'validation_failed', message: 'missing param' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    try {
      await unlinkUserAccount(projectId, userId, accountId);
      await audit({
        actorId: actor.id,
        projectId,
        action: 'auth.account.unlinked',
        ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
        userAgent: c.req.header('user-agent') ?? null,
        metadata: { userId, accountId },
      });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ code: 'validation_failed', message: err.message }, 400);
      }
      if ((err as { code?: string }).code === 'not_found') {
        return c.json({ code: 'not_found' }, 404);
      }
      throw err;
    }
  },
);

/**
 * Admin: force password change on next sign-in.
 */
authServiceRouter.post(
  '/v1/projects/:id/auth/users/:userId/force-password-reset',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    if (!projectId || !userId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :userId' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    await forcePasswordReset(projectId, userId, body.reason);
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.password.force_reset',
      ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { userId, reason: body.reason },
    });
    return c.json({ ok: true });
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

/**
 * SDK keys — reveal (copy again). Decrypts the AES-GCM ciphertext stored at
 * create time and returns the plaintext once more. Always writes an audit
 * row on success. Revoked / pre-0039 keys return 404 key_not_revealable.
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
      const revealed = await revealAuthSdkKey(projectId, keyId);
      await audit({
        actorId: actor.id,
        projectId,
        action: 'briven_auth.api_key.revealed',
        ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
        userAgent: c.req.header('user-agent') ?? null,
        metadata: { keyId },
      });
      return c.json({ plaintext: revealed.plaintext });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'not_found' || code === 'key_not_revealable') {
        return c.json({ code: code ?? 'not_found' }, 404);
      }
      throw err;
    }
  },
);

// ─── user moderation (ban / suspend) ─────────────────────────────────────

authServiceRouter.post(
  '/v1/projects/:id/auth/users/:userId/ban',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    if (!projectId || !userId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :userId' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string; expiresAt?: string };
    await banUser(projectId, userId, {
      reason: body.reason,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });
    await invalidateAuthInstance(projectId);
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.user.banned',
      ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { userId, reason: body.reason },
    });
    return c.json({ ok: true });
  },
);

authServiceRouter.post(
  '/v1/projects/:id/auth/users/:userId/unban',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    if (!projectId || !userId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :userId' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    await unbanUser(projectId, userId);
    await invalidateAuthInstance(projectId);
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.user.unbanned',
      ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { userId },
    });
    return c.json({ ok: true });
  },
);

authServiceRouter.post(
  '/v1/projects/:id/auth/users/:userId/suspend',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    if (!projectId || !userId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :userId' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    await suspendUser(projectId, userId, { reason: body.reason });
    await invalidateAuthInstance(projectId);
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.user.suspended',
      ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { userId, reason: body.reason },
    });
    return c.json({ ok: true });
  },
);

authServiceRouter.post(
  '/v1/projects/:id/auth/users/:userId/unsuspend',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    if (!projectId || !userId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :userId' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    await unsuspendUser(projectId, userId);
    await invalidateAuthInstance(projectId);
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.user.unsuspended',
      ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { userId },
    });
    return c.json({ ok: true });
  },
);

/**
 * Admin list a user's live sessions (no tokens — id + device hint only).
 */
authServiceRouter.get(
  '/v1/projects/:id/auth/users/:userId/sessions',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    if (!projectId || !userId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :userId' }, 400);
    }
    const { listSessionsForUser } = await import('../services/auth-device-tracking.js');
    const sessions = await listSessionsForUser(projectId, userId);
    return c.json({ items: sessions });
  },
);

/**
 * Admin list a user's known devices (fingerprint + human hint).
 */
authServiceRouter.get(
  '/v1/projects/:id/auth/users/:userId/devices',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    if (!projectId || !userId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :userId' }, 400);
    }
    const { listDevicesForUser } = await import('../services/auth-device-tracking.js');
    const devices = await listDevicesForUser(projectId, userId);
    return c.json({ items: devices });
  },
);

/**
 * Admin revoke a specific user session.
 */
authServiceRouter.post(
  '/v1/projects/:id/auth/users/:userId/sessions/:sessionId/revoke',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    const sessionId = c.req.param('sessionId');
    if (!projectId || !userId || !sessionId) {
      return c.json({ code: 'validation_failed', message: 'missing :id, :userId, or :sessionId' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);

    await runInProjectDatabase(projectId, async (tx) => {
      // Verify the session belongs to the specified user before deleting.
      const rows = (await tx.unsafe(
        `SELECT id FROM "_briven_auth_sessions" WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [sessionId, userId] as never,
      )) as Array<{ id: string }>;
      if (rows.length === 0) {
        throw new ValidationError('session not found for this user');
      }
      await tx.unsafe(
        `DELETE FROM "_briven_auth_sessions" WHERE id = $1`,
        [sessionId] as never,
      );
      await tx.unsafe(
        `DELETE FROM "_briven_auth_session_activity" WHERE session_id = $1`,
        [sessionId] as never,
      );
      await tx.unsafe(
        `DELETE FROM "_briven_auth_sso_sessions" WHERE session_id = $1`,
        [sessionId] as never,
      );
    });

    await invalidateAuthInstance(projectId);
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.session.revoked',
      ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { userId, sessionId },
    });
    return c.json({ ok: true });
  },
);

// ─── Phase 6.4 — Bulk Operations ──────────────────────────────────────────

const bulkBanSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(100),
  reason: z.string().max(500).optional(),
});

authServiceRouter.post(
  '/v1/projects/:id/auth/users/bulk-ban',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);

    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = bulkBanSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
    }

    const result = await bulkBanUsers(projectId, parsed.data.userIds, parsed.data.reason);
    await invalidateAuthInstance(projectId);
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.user.bulk_banned',
      ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { count: result.succeeded, failed: result.failed },
    });
    return c.json(result);
  },
);

const bulkDeleteSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(100),
});

authServiceRouter.post(
  '/v1/projects/:id/auth/users/bulk-delete',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);

    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = bulkDeleteSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
    }

    const result = await bulkDeleteUsers(projectId, parsed.data.userIds);
    await invalidateAuthInstance(projectId);
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.user.bulk_deleted',
      ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { count: result.succeeded, failed: result.failed },
    });
    return c.json(result);
  },
);

const bulkInviteSchema = z.object({
  orgId: z.string().min(1),
  emails: z.array(z.string().email()).min(1).max(100),
  role: z.enum(['admin', 'member']).optional(),
});

authServiceRouter.post(
  '/v1/projects/:id/auth/orgs/bulk-invite',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);

    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = bulkInviteSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
    }

    const result = await bulkInviteUsers(projectId, {
      orgId: parsed.data.orgId,
      emails: parsed.data.emails,
      role: parsed.data.role,
      invitedBy: actor.id,
    });
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.org.bulk_invited',
      ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { orgId: parsed.data.orgId, count: result.succeeded, failed: result.failed },
    });
    return c.json(result);
  },
);

// ─── waitlist management ─────────────────────────────────────────────────

authServiceRouter.get(
  '/v1/projects/:id/auth/waitlist',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    }
    const status = c.req.query('status') ?? undefined;
    const limitRaw = c.req.query('limit');
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const cursor = c.req.query('cursor') ?? null;
    const result = await listWaitlist(projectId, { status, limit, cursor });
    return c.json(result);
  },
);

authServiceRouter.post(
  '/v1/projects/:id/auth/waitlist/:entryId/approve',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const entryId = c.req.param('entryId');
    if (!projectId || !entryId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :entryId' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    await approveWaitlistEntry(projectId, entryId, actor.id);
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.waitlist.approved',
      ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { entryId },
    });
    return c.json({ ok: true });
  },
);

authServiceRouter.post(
  '/v1/projects/:id/auth/waitlist/:entryId/reject',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const entryId = c.req.param('entryId');
    if (!projectId || !entryId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :entryId' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    await rejectWaitlistEntry(projectId, entryId, { reason: body.reason });
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.waitlist.rejected',
      ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { entryId, reason: body.reason },
    });
    return c.json({ ok: true });
  },
);

// ─── user metadata (admin) ───────────────────────────────────────────────

authServiceRouter.get(
  '/v1/projects/:id/auth/users/:userId/metadata',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    if (!projectId || !userId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :userId' }, 400);
    }
    const meta = await getUserMetadata(projectId, userId);
    return c.json({ metadata: meta });
  },
);

authServiceRouter.patch(
  '/v1/projects/:id/auth/users/:userId/metadata',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    if (!projectId || !userId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :userId' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    const body = (await c.req.json().catch(() => ({}))) as {
      publicMetadata?: Record<string, unknown>;
      privateMetadata?: Record<string, unknown>;
    };
    const meta = await setUserMetadata(projectId, userId, {
      publicMetadata: body.publicMetadata,
      privateMetadata: body.privateMetadata,
    });
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.user.metadata.updated',
      ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { userId },
    });
    return c.json({ metadata: meta });
  },
);

authServiceRouter.delete(
  '/v1/projects/:id/auth/users/:userId/metadata',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    if (!projectId || !userId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :userId' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    await deleteUserMetadata(projectId, userId);
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.user.metadata.deleted',
      ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { userId },
    });
    return c.json({ ok: true });
  },
);

// ─── user emails (admin) ─────────────────────────────────────────────────

authServiceRouter.get(
  '/v1/projects/:id/auth/users/:userId/emails',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    if (!projectId || !userId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :userId' }, 400);
    }
    const emails = await listUserEmails(projectId, userId);
    return c.json({ emails });
  },
);

authServiceRouter.post(
  '/v1/projects/:id/auth/users/:userId/emails',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    if (!projectId || !userId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :userId' }, 400);
    }
    const body = (await c.req.json().catch(() => ({}))) as { email?: string };
    if (!body.email || typeof body.email !== 'string') {
      return c.json({ code: 'validation_failed', message: 'email required' }, 400);
    }
    const email = await addUserEmail(projectId, userId, body.email);
    return c.json({ email }, 201);
  },
);

authServiceRouter.post(
  '/v1/projects/:id/auth/users/:userId/emails/:emailId/verify',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    const emailId = c.req.param('emailId');
    if (!projectId || !userId || !emailId) {
      return c.json({ code: 'validation_failed', message: 'missing param' }, 400);
    }
    await verifyUserEmail(projectId, userId, emailId);
    return c.json({ ok: true });
  },
);

authServiceRouter.post(
  '/v1/projects/:id/auth/users/:userId/emails/:emailId/primary',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    const emailId = c.req.param('emailId');
    if (!projectId || !userId || !emailId) {
      return c.json({ code: 'validation_failed', message: 'missing param' }, 400);
    }
    await setPrimaryEmail(projectId, userId, emailId);
    return c.json({ ok: true });
  },
);

authServiceRouter.delete(
  '/v1/projects/:id/auth/users/:userId/emails/:emailId',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    const emailId = c.req.param('emailId');
    if (!projectId || !userId || !emailId) {
      return c.json({ code: 'validation_failed', message: 'missing param' }, 400);
    }
    await removeUserEmail(projectId, userId, emailId);
    return c.json({ ok: true });
  },
);

// ─── Password Policy (Gap Fix #13) ────────────────────────────────────────

authServiceRouter.get(
  '/v1/projects/:id/auth/password-policy',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    const policy = await getPasswordPolicy(projectId);
    return c.json({ policy });
  },
);

authServiceRouter.put(
  '/v1/projects/:id/auth/password-policy',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const policy = await setPasswordPolicy(projectId, {
      minLength: typeof body.minLength === 'number' ? body.minLength : undefined,
      requireUppercase: typeof body.requireUppercase === 'boolean' ? body.requireUppercase : undefined,
      requireLowercase: typeof body.requireLowercase === 'boolean' ? body.requireLowercase : undefined,
      requireNumber: typeof body.requireNumber === 'boolean' ? body.requireNumber : undefined,
      requireSpecial: typeof body.requireSpecial === 'boolean' ? body.requireSpecial : undefined,
      maxAgeDays: typeof body.maxAgeDays === 'number' ? body.maxAgeDays : null,
      preventReuse: typeof body.preventReuse === 'number' ? body.preventReuse : undefined,
    });
    return c.json({ policy });
  },
);

// ─── GDPR Data Export (Gap Fix #15) ───────────────────────────────────────

authServiceRouter.get(
  '/v1/projects/:id/auth/users/:userId/export',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    if (!projectId || !userId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :userId' }, 400);
    }
    const data = await exportUserData(projectId, userId);
    return c.json({ data });
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
 * Validate the SDK key sent as `Authorization: Bearer <publicKey>`.
 * Returns `null` when the key is valid or when no Authorization header
 * is present (browser-navigation flows such as email links cannot carry
 * custom headers). Returns a `Response` when the key is invalid, expired,
 * mismatched, or has insufficient scope for the HTTP method.
 */
async function enforceSdkKeyScope(
  c: {
    req: { header: (k: string) => string | undefined; method: string };
    json: (obj: unknown, status?: number) => Response;
  },
  projectId: string,
): Promise<Response | null> {
  const authHeader = c.req.header('authorization');
  if (!authHeader) return null; // Browser flows — no key to validate.

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return c.json(
      { code: 'invalid_auth_header', message: 'Authorization header must be Bearer <token>' },
      401,
    );
  }

  const resolved = await resolveAuthSdkKey(match[1]!);
  if (!resolved) {
    return c.json(
      { code: 'invalid_sdk_key', message: 'SDK key is invalid, revoked, or expired' },
      401,
    );
  }

  if (resolved.projectId !== projectId) {
    return c.json(
      { code: 'sdk_key_mismatch', message: 'SDK key does not belong to this project' },
      403,
    );
  }

  const { sdkKeyAllowsMethod } = await import('../services/auth-hardening.js');
  if (!sdkKeyAllowsMethod(resolved.scope, c.req.method)) {
    return c.json(
      { code: 'insufficient_scope', message: 'read key cannot modify state' },
      403,
    );
  }

  return null; // Valid key with sufficient scope.
}

/**
 * Validate a SAML/OIDC RelayState (or redirectTo) against a project's
 * registered app origins. Prevents open-redirect attacks via the IdP
 * response. Pure origin rules live in auth-hardening.sanitizeRelayState.
 */
async function validateRelayState(
  relayState: string,
  projectId: string,
): Promise<string> {
  const { sanitizeRelayState } = await import('../services/auth-hardening.js');
  const allowed = await originsForProject(projectId);
  const allAllowed = [...allowed, env.BRIVEN_WEB_ORIGIN, env.BRIVEN_API_ORIGIN].filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  );
  return sanitizeRelayState(relayState, allAllowed);
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



// ─── tenant session helper ────────────────────────────────────────────────

/**
 * Resolve the current user id from the tenant session cookie.
 * Makes an internal sub-request to the project's Better Auth instance
 * so the exact same session validation runs (cookie parsing, token
 * verification, expiry checks).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getTenantUserId(c: any, projectId: string): Promise<string | null> {
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

interface TenantSession {
  userId: string;
  sessionId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getTenantSession(c: any, projectId: string): Promise<TenantSession | null> {
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
    const body = (await response.json()) as {
      user?: { id?: string };
      session?: { id?: string };
    } | null;
    const userId = body?.user?.id;
    const sessionId = body?.session?.id;
    if (!userId || !sessionId) return null;
    return { userId, sessionId };
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
  if (!(await hasPermission(projectId, orgId, userId, 'org:update'))) {
    return c.json({ code: 'forbidden', message: 'insufficient permissions' }, 403);
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
  if (!(await hasPermission(projectId, orgId, userId, 'org:delete'))) {
    return c.json({ code: 'forbidden', message: 'insufficient permissions' }, 403);
  }
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
  if (!(await hasPermission(projectId, orgId, userId, 'member:add'))) {
    return c.json({ code: 'forbidden', message: 'insufficient permissions' }, 403);
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
  if (!(await hasPermission(projectId, orgId, userId, 'member:update_role'))) {
    return c.json({ code: 'forbidden', message: 'insufficient permissions' }, 403);
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
  if (!(await hasPermission(projectId, orgId, userId, 'member:remove'))) {
    return c.json({ code: 'forbidden', message: 'insufficient permissions' }, 403);
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
  if (!(await hasPermission(projectId, orgId, userId, 'invite:list'))) {
    return c.json({ code: 'forbidden', message: 'insufficient permissions' }, 403);
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
  if (!(await hasPermission(projectId, orgId, userId, 'invite:create'))) {
    return c.json({ code: 'forbidden', message: 'insufficient permissions' }, 403);
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
  if (!(await hasPermission(projectId, orgId, userId, 'invite:revoke'))) {
    return c.json({ code: 'forbidden', message: 'insufficient permissions' }, 403);
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

// ─── Phase 4 — Custom Roles ───────────────────────────────────────────────

authServiceRouter.get('/v1/auth-tenant/orgs/:id/roles', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  const roles = await listOrgRoles(projectId, orgId);
  return c.json({ roles });
});

authServiceRouter.post('/v1/auth-tenant/orgs/:id/roles', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  if (!(await hasPermission(projectId, orgId, userId, 'member:update_role'))) {
    return c.json({ code: 'forbidden', message: 'insufficient permissions' }, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  try {
    const role = await createOrgRole(projectId, orgId, { name: body.name, permissions: body.permissions ?? [] });
    return c.json({ role });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
    return c.json({ code: 'role_create_failed' }, 500);
  }
});

authServiceRouter.patch('/v1/auth-tenant/orgs/:id/roles/:roleId', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  if (!(await hasPermission(projectId, orgId, userId, 'member:update_role'))) {
    return c.json({ code: 'forbidden', message: 'insufficient permissions' }, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  try {
    const role = await updateOrgRole(projectId, orgId, c.req.param('roleId'), {
      name: body.name,
      permissions: body.permissions,
    });
    return c.json({ role });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
    return c.json({ code: 'role_update_failed' }, 500);
  }
});

authServiceRouter.delete('/v1/auth-tenant/orgs/:id/roles/:roleId', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  if (!(await hasPermission(projectId, orgId, userId, 'member:update_role'))) {
    return c.json({ code: 'forbidden', message: 'insufficient permissions' }, 403);
  }
  try {
    await deleteOrgRole(projectId, orgId, c.req.param('roleId'));
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
    return c.json({ code: 'role_delete_failed' }, 500);
  }
});

// ─── Phase 4 — Domain Verification ────────────────────────────────────────

authServiceRouter.get('/v1/auth-tenant/orgs/:id/domains', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  if (!(await hasPermission(projectId, orgId, userId, 'domain:manage'))) {
    return c.json({ code: 'forbidden', message: 'insufficient permissions' }, 403);
  }
  const domains = await listOrgDomains(projectId, orgId);
  return c.json({ domains });
});

authServiceRouter.post('/v1/auth-tenant/orgs/:id/domains', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  if (!(await hasPermission(projectId, orgId, userId, 'domain:manage'))) {
    return c.json({ code: 'forbidden', message: 'insufficient permissions' }, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  try {
    const domain = await addOrgDomain(projectId, orgId, body.domain);
    return c.json({ domain });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
    return c.json({ code: 'domain_add_failed' }, 500);
  }
});

authServiceRouter.post('/v1/auth-tenant/orgs/:id/domains/:domainId/verify', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  if (!(await hasPermission(projectId, orgId, userId, 'domain:manage'))) {
    return c.json({ code: 'forbidden', message: 'insufficient permissions' }, 403);
  }
  try {
    const domain = await verifyOrgDomain(projectId, orgId, c.req.param('domainId'));
    return c.json({ domain });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
    return c.json({ code: 'domain_verify_failed' }, 500);
  }
});

authServiceRouter.patch('/v1/auth-tenant/orgs/:id/domains/:domainId/auto-join', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  if (!(await hasPermission(projectId, orgId, userId, 'domain:manage'))) {
    return c.json({ code: 'forbidden', message: 'insufficient permissions' }, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  try {
    const domain = await setOrgDomainAutoJoin(projectId, orgId, c.req.param('domainId'), Boolean(body.enabled));
    return c.json({ domain });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
    return c.json({ code: 'domain_update_failed' }, 500);
  }
});

authServiceRouter.delete('/v1/auth-tenant/orgs/:id/domains/:domainId', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  if (!(await hasPermission(projectId, orgId, userId, 'domain:manage'))) {
    return c.json({ code: 'forbidden', message: 'insufficient permissions' }, 403);
  }
  await removeOrgDomain(projectId, orgId, c.req.param('domainId'));
  return c.json({ ok: true });
});

// ─── Phase 4 — Membership Requests ────────────────────────────────────────

authServiceRouter.post('/v1/auth-tenant/orgs/:id/membership-requests', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  try {
    const request = await createMembershipRequest(projectId, orgId, userId, body.message);
    return c.json({ request });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
    return c.json({ code: 'request_create_failed' }, 500);
  }
});

authServiceRouter.get('/v1/auth-tenant/orgs/:id/membership-requests', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  if (!(await hasPermission(projectId, orgId, userId, 'request:approve'))) {
    return c.json({ code: 'forbidden', message: 'insufficient permissions' }, 403);
  }
  const status = c.req.query('status') as 'pending' | 'approved' | 'rejected' | undefined;
  const requests = await listMembershipRequests(projectId, orgId, status);
  return c.json({ requests });
});

authServiceRouter.post('/v1/auth-tenant/orgs/:id/membership-requests/:requestId/resolve', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  if (!(await hasPermission(projectId, orgId, userId, 'request:approve'))) {
    return c.json({ code: 'forbidden', message: 'insufficient permissions' }, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  try {
    const request = await resolveMembershipRequest(projectId, orgId, c.req.param('requestId'), userId, body.decision);
    return c.json({ request });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
    return c.json({ code: 'request_resolve_failed' }, 500);
  }
});

// ─── Phase 4 — Active Organization ────────────────────────────────────────

authServiceRouter.post('/v1/auth-tenant/orgs/:id/set-active', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const session = await getTenantSession(c, projectId);
  if (!session) return c.json({ code: 'unauthenticated' }, 401);
  const orgId = c.req.param('id');
  // Verify the user is actually a member of this org
  const role = await getUserOrgRole(projectId, orgId, session.userId);
  if (!role) return c.json({ code: 'forbidden', message: 'not a member of this org' }, 403);
  await setSessionActiveOrg(projectId, session.sessionId, orgId);
  return c.json({ ok: true });
});

authServiceRouter.get('/v1/auth-tenant/orgs/active', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const session = await getTenantSession(c, projectId);
  if (!session) return c.json({ code: 'unauthenticated' }, 401);
  const activeOrgId = await getSessionActiveOrg(projectId, session.sessionId);
  if (!activeOrgId) return c.json({ activeOrg: null });
  const org = await getOrg(projectId, activeOrgId);
  return c.json({ activeOrg: org });
});

// ─── user metadata (customer-facing) ─────────────────────────────────────

authServiceRouter.get('/v1/auth-tenant/user/metadata', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const meta = await getUserPublicMetadata(projectId, userId);
  return c.json({ publicMetadata: meta });
});

authServiceRouter.patch('/v1/auth-tenant/user/metadata', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const body = (await c.req.json().catch(() => ({}))) as {
    publicMetadata?: Record<string, unknown>;
  };
  const meta = await setUserMetadata(
    projectId,
    userId,
    { publicMetadata: body.publicMetadata },
    { merge: true },
  );
  return c.json({ publicMetadata: meta.publicMetadata });
});

// ─── user emails (customer-facing) ───────────────────────────────────────

authServiceRouter.get('/v1/auth-tenant/user/emails', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const emails = await listUserEmails(projectId, userId);
  return c.json({ emails });
});

authServiceRouter.post('/v1/auth-tenant/user/emails', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { email?: string };
  if (!body.email || typeof body.email !== 'string') {
    return c.json({ code: 'validation_failed', message: 'email required' }, 400);
  }
  try {
    const email = await addUserEmail(projectId, userId, body.email);
    return c.json({ email }, 201);
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
    return c.json({ code: 'email_add_failed' }, 500);
  }
});

authServiceRouter.delete('/v1/auth-tenant/user/emails/:emailId', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);
  await removeUserEmail(projectId, userId, c.req.param('emailId'));
  return c.json({ ok: true });
});

// ─── user avatar (Phase 7.2 — customer-facing) ────────────────────────────

authServiceRouter.post('/v1/auth-tenant/user/avatar/presign', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);

  if (!isStorageConfigured()) {
    return c.json({ code: 'storage_not_configured' }, 503);
  }

  const body = (await c.req.json().catch(() => ({}))) as { contentType?: string };
  if (!body.contentType) {
    return c.json({ code: 'validation_failed', message: 'contentType required' }, 400);
  }

  try {
    const result = generateAvatarPresign(projectId, userId, body.contentType);
    return c.json(result);
  } catch (err) {
    return c.json(
      { code: 'validation_failed', message: err instanceof Error ? err.message : 'invalid content type' },
      400,
    );
  }
});

authServiceRouter.patch('/v1/auth-tenant/user/avatar', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);

  const body = (await c.req.json().catch(() => ({}))) as { imageUrl?: string | null };
  await updateUserAvatar(projectId, userId, body.imageUrl ?? null);
  return c.json({ ok: true });
});

authServiceRouter.get('/v1/auth-tenant/user/avatar/serve', async (c) => {
  const q = new URL(c.req.url).searchParams;
  const projectId = q.get('p');
  const userId = q.get('u');
  const fileId = q.get('f');
  if (!projectId || !userId || !fileId) {
    return c.json({ code: 'validation_failed' }, 400);
  }

  try {
    const img = await getAvatarImage(projectId, userId, fileId);
    if (!img) return c.body(null, 404);
    c.header('content-type', img.contentType);
    c.header('cache-control', 'public, max-age=86400');
    return c.body(Buffer.from(img.bytes));
  } catch {
    return c.json({ code: 'avatar_fetch_failed' }, 500);
  }
});

// ─── username authentication (Phase 7.3 — customer-facing) ────────────────

authServiceRouter.post('/v1/auth-tenant/username/sign-in', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);

  const body = (await c.req.json().catch(() => ({}))) as { username?: string; password?: string };
  if (!body.username || !body.password) {
    return c.json({ code: 'validation_failed', message: 'username and password required' }, 400);
  }

  const resolved = await resolveUsernameToEmail(projectId, body.username);
  if (!resolved) {
    return c.json({ code: 'invalid_credentials' }, 401);
  }

  const instance = await getAuthInstance(projectId);
  const signInUrl = new URL(c.req.url);
  signInUrl.pathname = '/v1/auth-tenant/sign-in/email';

  const signInReq = new Request(signInUrl.toString(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-briven-project-id': projectId,
    },
    body: JSON.stringify({ email: resolved.email, password: body.password }),
  });

  const response = await instance.betterAuth.handler(signInReq);
  return await withActionableOriginError(response, projectId);
});

authServiceRouter.post('/v1/auth-tenant/username', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);

  const body = (await c.req.json().catch(() => ({}))) as { username?: string };
  if (!body.username) {
    return c.json({ code: 'validation_failed', message: 'username required' }, 400);
  }

  try {
    validateUsername(body.username);
    await createUsername(projectId, userId, body.username);
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ code: 'validation_failed', message: err.message }, 400);
    }
    return c.json({ code: 'username_taken', message: 'username already taken' }, 409);
  }
});

authServiceRouter.get('/v1/auth-tenant/username', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);

  const username = await getUsernameByUserId(projectId, userId);
  return c.json({ username });
});

authServiceRouter.delete('/v1/auth-tenant/username', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const userId = await getTenantUserId(c, projectId);
  if (!userId) return c.json({ code: 'unauthenticated' }, 401);

  await deleteUsername(projectId, userId);
  return c.json({ ok: true });
});

// ─── test token exchange (Phase 7.4 — customer-facing) ────────────────────

authServiceRouter.post('/v1/auth-tenant/test-token', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);

  const body = (await c.req.json().catch(() => ({}))) as { token?: string };
  if (!body.token || typeof body.token !== 'string') {
    return c.json({ code: 'validation_failed', message: 'token required' }, 400);
  }

  const result = await exchangeTestToken(projectId, body.token);
  if (!result) {
    return c.json({ code: 'invalid_token' }, 401);
  }

  const isProd = env.BRIVEN_ENV === 'production';
  const cookieValue = `${SESSION_COOKIE_NAME}=${encodeURIComponent(result.sessionToken)}; Path=/; HttpOnly; SameSite=${isProd ? 'None' : 'Lax'}${isProd ? '; Secure' : ''}; Max-Age=604800`;
  c.header('set-cookie', cookieValue);

  return c.json({ ok: true, expiresAt: result.expiresAt.toISOString() });
});

// ─── sign-in tokens (customer-facing) ─────────────────────────────────────

authServiceRouter.post('/v1/auth-tenant/sign-in/token', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { token?: string };
  if (!body.token || typeof body.token !== 'string') {
    return c.json({ code: 'validation_failed', message: 'token required' }, 400);
  }
  try {
    const result = await exchangeSigninToken(projectId, body.token, {
      userAgent: c.req.header('user-agent') ?? null,
    });
    // Set the session cookie so the client is authenticated on the next request.
    // Cookie attributes mirror Better Auth's defaults (cookiePrefix: 'briven-auth').
    const isProd = env.BRIVEN_ENV === 'production';
    const cookieValue = `${SESSION_COOKIE_NAME}=${encodeURIComponent(result.sessionToken)}; Path=/; HttpOnly; SameSite=${isProd ? 'None' : 'Lax'}${isProd ? '; Secure' : ''}; Max-Age=604800`;
    c.header('set-cookie', cookieValue);
    return c.json({ ok: true, expiresAt: result.expiresAt.toISOString() });
  } catch (err) {
    if (err instanceof SigninTokenError) {
      const status = err.code === 'token_already_used' ? 410 : 401;
      return c.json({ code: err.code, message: err.message }, status);
    }
    log.error('briven_auth_signin_token_exchange_failed', {
      projectId,
      message: err instanceof Error ? err.message : String(err),
    });
    return c.json({ code: 'token_exchange_failed' }, 500);
  }
});

// ─── JWT token generation (Phase 7.1) ─────────────────────────────────────

authServiceRouter.post('/v1/auth-tenant/jwt/token', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);

  const body = (await c.req.json().catch(() => ({}))) as { template?: string };
  const cookieHeader = c.req.header('cookie') ?? '';
  const match = cookieHeader.match(/briven_auth_session_token=([^;]+)/);
  const sessionToken = match?.[1] ?? null;

  if (!sessionToken) {
    return c.json({ code: 'unauthenticated' }, 401);
  }

  const result = await generateJwtToken(projectId, sessionToken, body.template);
  if ('error' in result) {
    return c.json({ code: result.error }, 400);
  }

  return c.json({ token: result.token, expiresAt: result.expiresAt.toISOString() });
});

authServiceRouter.get('/v1/auth-tenant/jwt/jwks', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const jwks = await getCustomJwks(projectId);
  return c.json(jwks);
});

// ─── sign-in tokens (admin) ────────────────────────────────────────────────

authServiceRouter.post(
  '/v1/projects/:id/auth/users/:userId/signin-token',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    if (!projectId || !userId) {
      return c.json({ code: 'validation_failed', message: 'missing :id or :userId' }, 400);
    }
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { ttlMinutes?: number };
    try {
      const created = await createSigninToken(projectId, userId, {
        ttlMinutes: typeof body.ttlMinutes === 'number' ? body.ttlMinutes : undefined,
      });
      await audit({
        actorId: actor.id,
        projectId,
        action: 'auth.user.signin_token.created',
        ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
        userAgent: c.req.header('user-agent') ?? null,
        metadata: { userId },
      });
      return c.json({ token: created.token, expiresAt: created.expiresAt.toISOString() });
    } catch (err) {
      log.error('briven_auth_signin_token_create_failed', {
        projectId,
        userId,
        message: err instanceof Error ? err.message : String(err),
      });
      return c.json({ code: 'token_create_failed' }, 500);
    }
  },
);

// ─── Phase 5 — Enterprise SSO (admin) ─────────────────────────────────────

authServiceRouter.get(
  '/v1/projects/:id/auth/sso/connections',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    const connections = await listSsoConnections(projectId);
    return c.json({ connections });
  },
);

authServiceRouter.post(
  '/v1/projects/:id/auth/sso/connections',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    const body = await c.req.json().catch(() => ({}));
    try {
      const connection = await createSsoConnection(projectId, {
        name: body.name,
        providerType: body.providerType,
        config: body.config ?? {},
        domains: body.domains,
        jitEnabled: body.jitEnabled,
      });
      return c.json({ connection });
    } catch (err) {
      if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
      log.error('sso_connection_create_failed', { projectId, message: err instanceof Error ? err.message : String(err) });
      return c.json({ code: 'sso_connection_create_failed' }, 500);
    }
  },
);

authServiceRouter.patch(
  '/v1/projects/:id/auth/sso/connections/:connectionId',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    const body = await c.req.json().catch(() => ({}));
    try {
      const connection = await updateSsoConnection(projectId, c.req.param('connectionId'), {
        name: body.name,
        config: body.config,
        domains: body.domains,
        jitEnabled: body.jitEnabled,
      });
      return c.json({ connection });
    } catch (err) {
      if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
      return c.json({ code: 'sso_connection_update_failed' }, 500);
    }
  },
);

authServiceRouter.delete(
  '/v1/projects/:id/auth/sso/connections/:connectionId',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    await deleteSsoConnection(projectId, c.req.param('connectionId'));
    return c.json({ ok: true });
  },
);

authServiceRouter.post(
  '/v1/projects/:id/auth/sso/connections/:connectionId/revoke-sessions',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    const count = await revokeAllSessionsForConnection(projectId, c.req.param('connectionId'));
    return c.json({ revoked: count });
  },
);

// ─── Phase 5 — Enterprise SSO (customer-facing) ───────────────────────────

authServiceRouter.get('/v1/auth-tenant/sso/connections', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const connections = await listSsoConnections(projectId);
  // Strip config from public response — it may contain certs/secrets.
  return c.json({
    connections: connections.map((c) => ({
      id: c.id,
      name: c.name,
      providerType: c.providerType,
      domains: c.domains,
    })),
  });
});

authServiceRouter.get('/v1/auth-tenant/sso/domain/:domain', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const connection = await findConnectionByDomain(projectId, c.req.param('domain'));
  if (!connection) return c.json({ code: 'not_found' }, 404);
  return c.json({
    connection: {
      id: connection.id,
      name: connection.name,
      providerType: connection.providerType,
      domains: connection.domains,
    },
  });
});

// SAML
authServiceRouter.get('/v1/auth-tenant/sso/saml/:connectionId/metadata', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  try {
    const metadata = await generateSamlMetadata(projectId, c.req.param('connectionId'));
    return c.text(metadata, 200, { 'content-type': 'application/xml' });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
    return c.json({ code: 'metadata_generation_failed' }, 500);
  }
});

authServiceRouter.get('/v1/auth-tenant/sso/saml/:connectionId', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const relayState = await validateRelayState(c.req.query('redirectTo') ?? '/', projectId);
  try {
    const { redirectUrl } = await generateSamlAuthnRequest(projectId, c.req.param('connectionId'), relayState);
    return c.redirect(redirectUrl);
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ code: 'validation_failed', message: err.message }, 400);
    return c.json({ code: 'saml_request_failed' }, 500);
  }
});

authServiceRouter.post('/v1/auth-tenant/sso/saml/:connectionId/acs', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);

  const connectionId = c.req.param('connectionId');
  const body = await c.req.parseBody();
  const samlResponse = body.SAMLResponse as string;
  if (!samlResponse) {
    return c.json({ code: 'validation_failed', message: 'SAMLResponse is required' }, 400);
  }

  try {
    const assertion = await validateSamlResponse(projectId, connectionId, samlResponse);
    const conn = await getSsoConnection(projectId, connectionId);
    if (!conn) throw new ValidationError('connection not found');

    // JIT provisioning + session creation.
    const user = await findOrCreateSsoUser(projectId, assertion.email, assertion.name, conn.jitEnabled);
    const { sessionToken, expiresAt } = await createSsoSession(projectId, user.id, connectionId, {
      userAgent: c.req.header('user-agent') ?? null,
    });

    // Set session cookie.
    const isProduction = env.BRIVEN_ENV === 'production';
    const cookieValue = `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=${isProduction ? 'None' : 'Lax'}${isProduction ? '; Secure' : ''}; Expires=${expiresAt.toUTCString()}`;
    c.header('set-cookie', cookieValue);

    // Redirect to the app's callback URL (from RelayState) or default.
    const relayState = await validateRelayState((body.RelayState as string) || '/', projectId);
    return c.redirect(relayState);
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ code: 'validation_failed', message: err.message }, 400);
    }
    log.error('saml_acs_failed', {
      projectId,
      connectionId,
      message: err instanceof Error ? err.message : String(err),
    });
    return c.json({ code: 'saml_acs_failed' }, 500);
  }
});

// ─── OIDC Enterprise (Gap Fix #3) ─────────────────────────────────────────

authServiceRouter.get('/v1/auth-tenant/sso/oidc/:connectionId', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const connectionId = c.req.param('connectionId');
  const redirectTo = await validateRelayState(c.req.query('redirectTo') ?? '/', projectId);

  try {
    const { redirectUrl } = await generateOidcAuthUrl(projectId, connectionId, { redirectTo });
    return c.redirect(redirectUrl);
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ code: 'validation_failed', message: err.message }, 400);
    }
    log.error('oidc_start_failed', {
      projectId,
      connectionId,
      message: err instanceof Error ? err.message : String(err),
    });
    return c.json({ code: 'oidc_start_failed' }, 500);
  }
});

authServiceRouter.get('/v1/auth-tenant/sso/oidc/:connectionId/callback', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);
  const connectionId = c.req.param('connectionId');
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) {
    return c.json({ code: 'validation_failed', message: 'code and state are required' }, 400);
  }

  try {
    const userinfo = await exchangeOidcCode(projectId, connectionId, code, state);
    const conn = await getSsoConnection(projectId, connectionId);
    if (!conn) throw new ValidationError('connection not found');

    const user = await findOrCreateSsoUser(projectId, userinfo.email, userinfo.name, conn.jitEnabled);
    const { sessionToken, expiresAt } = await createSsoSession(projectId, user.id, connectionId, {
      userAgent: c.req.header('user-agent') ?? null,
    });

    const isProduction = env.BRIVEN_ENV === 'production';
    const cookieValue = `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=${isProduction ? 'None' : 'Lax'}${isProduction ? '; Secure' : ''}; Expires=${expiresAt.toUTCString()}`;
    c.header('set-cookie', cookieValue);

    // Prefer redirect stored at OIDC start (validated); fallback to query RelayState.
    const preferred =
      userinfo.redirectTo && userinfo.redirectTo.length > 0
        ? userinfo.redirectTo
        : c.req.query('RelayState') || '/';
    const relayState = await validateRelayState(preferred, projectId);
    return c.redirect(relayState);
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ code: 'validation_failed', message: err.message }, 400);
    }
    log.error('oidc_callback_failed', {
      projectId,
      connectionId,
      message: err instanceof Error ? err.message : String(err),
    });
    return c.json({ code: 'oidc_callback_failed' }, 500);
  }
});

// ─── Catch-all bridge ─────────────────────────────────────────────────────

// ─── session activity helpers ─────────────────────────────────────────────

const SESSION_COOKIE_NAME = 'briven-auth.session_token';

function extractSessionToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === SESSION_COOKIE_NAME && value) {
      return decodeURIComponent(value);
    }
  }
  return undefined;
}

/**
 * Check whether a session has exceeded the inactivity timeout.
 * Returns { active: true } when there is no session cookie, no activity
 * record, or the session is still within the timeout window.
 */
async function checkSessionActivity(
  projectId: string,
  cookieHeader: string | undefined,
  timeoutMinutes: number,
): Promise<{ active: boolean; reason?: string }> {
  if (timeoutMinutes <= 0) return { active: true };
  const token = extractSessionToken(cookieHeader);
  if (!token) return { active: true };

  try {
    const rows = await runInProjectDatabase<
      Array<{ last_active_at: Date | null }>
    >(projectId, async (tx) =>
      tx.unsafe(
        `SELECT a.last_active_at
         FROM "_briven_auth_session_activity" a
         JOIN "_briven_auth_sessions" s ON a.session_id = s.id
         WHERE s.token = $1
         LIMIT 1`,
        [token] as never,
      ) as never,
    );
    const row = rows[0];
    if (!row || !row.last_active_at) return { active: true };

    const inactiveMs = Date.now() - new Date(row.last_active_at).getTime();
    const timeoutMs = timeoutMinutes * 60 * 1000;
    if (inactiveMs > timeoutMs) {
      return { active: false, reason: 'session expired due to inactivity' };
    }
    return { active: true };
  } catch {
    // Fail-open: if the query errors, allow the request.
    return { active: true };
  }
}

/**
 * Touch (update) the session activity timestamp. Fire-and-forget — never
 * blocks the request path.
 */
async function touchSessionActivity(
  projectId: string,
  cookieHeader: string | undefined,
): Promise<void> {
  const token = extractSessionToken(cookieHeader);
  if (!token) return;

  try {
    await runInProjectDatabase(projectId, async (tx) => {
      await tx.unsafe(
        `UPDATE "_briven_auth_session_activity" a
         SET last_active_at = now(), updated_at = now()
         FROM "_briven_auth_sessions" s
         WHERE a.session_id = s.id AND s.token = $1`,
        [token] as never,
      );
    });
  } catch {
    // Swallow — activity tracking must never break requests.
  }
}

/**
 * Security-aware request processing for the tenant-auth bridge.
 *
 * For eligible JSON POSTs (sign-in, sign-up, magic-link, OTP, password reset):
 *   1. Parse the body
 *   2. Apply rate limiting by email
 *   3. Verify Turnstile token when enabled
 *   4. Check email allowlist/blocklist for sign-up
 *   5. Check waitlist mode for sign-up
 *   6. Check password breach for sign-up / password reset
 *   7. Check session inactivity timeout
 *   8. Normalize callbacks (existing behavior)
 *
 * Returns either a Response (when a security check fails) or a modified
 * Request (when all checks pass) to be forwarded to Better Auth.
 */
async function processTenantRequest(
  raw: Request,
  projectId: string,
  config: Awaited<ReturnType<typeof getAuthConfig>>,
  clientIp: string,
): Promise<Response | Request> {
  const path = new URL(raw.url).pathname;

  // ── rate limiting by email (only for JSON POSTs to auth endpoints) ──
  const isAuthPost =
    raw.method === 'POST' &&
    (path.includes('/sign-up') ||
      path.includes('/sign-in') ||
      path.includes('/forget-password') ||
      path.includes('/reset-password') ||
      path.includes('/send-verification-email'));

  if (isAuthPost && config.security.rateLimiting.enabled) {
    const ipLimit = await checkIpRateLimit(projectId, clientIp, {
      maxAttempts: config.security.rateLimiting.maxAttemptsPerIp,
      windowMinutes: config.security.rateLimiting.windowMinutes,
    });
    if (!ipLimit.allowed) {
      return new Response(
        JSON.stringify({
          code: 'rate_limited',
          message: 'too many requests from this IP address',
          retryAfter: ipLimit.retryAfterSeconds,
        }),
        {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': String(ipLimit.retryAfterSeconds),
          },
        },
      );
    }
  }

  // Only parse JSON for the specific endpoints we need to inspect.
  const eligible =
    raw.method === 'POST' &&
    (path.includes('/sign-in/') ||
      path.includes('/sign-up') ||
      path.includes('/forget-password') ||
      path.includes('/reset-password') ||
      path.includes('/send-verification-email'));

  if (!eligible) return raw;

  const contentType = raw.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) return raw;

  let parsed: unknown;
  try {
    parsed = await raw.clone().json();
  } catch {
    return raw;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return raw;
  const body = parsed as Record<string, unknown>;

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined;

  // ── email rate limiting ──
  if (isAuthPost && email && config.security.rateLimiting.enabled) {
    const emailLimit = await checkEmailRateLimit(projectId, email, {
      maxAttempts: 5,
      windowMinutes: 15,
    });
    if (!emailLimit.allowed) {
      return new Response(
        JSON.stringify({
          code: 'rate_limited',
          message: 'too many requests for this email address',
          retryAfter: emailLimit.retryAfterSeconds,
        }),
        {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': String(emailLimit.retryAfterSeconds),
          },
        },
      );
    }
  }

  // ── turnstile verification ──
  if (config.turnstile.enabled && config.turnstile.siteKey) {
    const turnstileToken =
      typeof body.turnstileToken === 'string' ? body.turnstileToken : undefined;
    if (!turnstileToken) {
      return new Response(
        JSON.stringify({
          code: 'turnstile_required',
          message: 'bot protection verification is required',
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    }
    const turnstile = await verifyTurnstileToken(turnstileToken);
    if (!turnstile.success) {
      return new Response(
        JSON.stringify({
          code: 'turnstile_failed',
          message: turnstile.message ?? 'bot protection verification failed',
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    }
  }

  // ── sign-up gate (email allowlist / blocklist / waitlist) ──
  const isSignUp = path.includes('/sign-up');
  if (isSignUp && email) {
    const gate = await checkSignUpGate(projectId, email, {
      signUpMode: config.security.signUpMode,
      allowedDomains: config.security.allowedEmailDomains,
      blockedDomains: config.security.blockedEmailDomains,
      blockDisposable: config.security.blockDisposableEmails,
      blockSubaddresses: config.security.blockEmailSubaddresses,
    });
    if (!gate.allowed) {
      return new Response(
        JSON.stringify({
          code: 'sign_up_not_allowed',
          message: gate.reason ?? 'sign-up is not allowed',
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }
  }

  // ── password breach detection ──
  const password = typeof body.password === 'string' ? body.password : undefined;
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : undefined;
  const passwordToCheck = password ?? newPassword;
  if (passwordToCheck && config.security.breachDetection.enabled) {
    const breach = await checkPasswordBreach(passwordToCheck);
    if (breach.breached) {
      return new Response(
        JSON.stringify({
          code: 'password_breached',
          message:
            'this password has been found in a data breach. please choose a different password.',
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    }
  }

  // ── password policy enforcement (complexity + reuse) ──
  const isPasswordChange =
    path.includes('/sign-up') ||
    path.includes('/reset-password') ||
    path.includes('/change-password');
  if (isPasswordChange && passwordToCheck) {
    try {
      const policy = await getPasswordPolicy(projectId);
      validatePassword(passwordToCheck, policy);
      // Reuse check needs a user id when available (change/reset for known user).
      const bodyUserId =
        typeof body.userId === 'string'
          ? body.userId
          : typeof (body as { user?: { id?: string } }).user?.id === 'string'
            ? (body as { user: { id: string } }).user.id
            : null;
      if (bodyUserId && policy.preventReuse > 0) {
        await assertPasswordNotReused(projectId, bodyUserId, passwordToCheck, policy);
      }
    } catch (err) {
      if (err instanceof ValidationError) {
        return new Response(
          JSON.stringify({ code: 'weak_password', message: err.message }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      }
      // Unexpected error — swallow and let Better Auth handle it.
    }
  }

  // ── callback normalization (existing behavior) ──
  const normalized = normalizeTenantCallbacks(body, raw.headers.get('origin'));
  const headers = new Headers(raw.headers);
  headers.delete('content-length');
  return new Request(raw.url, {
    method: raw.method,
    headers,
    body: JSON.stringify(normalized),
  });
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
        message:
          'missing or malformed tenant id (x-briven-project-id header or briven_project_id query param)',
      },
      400,
    );
  }

  // Enforce SDK key scope when an Authorization header is present.
  const keyError = await enforceSdkKeyScope(c, projectId);
  if (keyError) return keyError;

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

  const clientIp = ip ?? 'unknown';

  try {
    const instance = await getAuthInstance(projectId);
    const config = await getAuthConfig(projectId);

    // Session inactivity timeout — checked on EVERY authenticated request,
    // not just the eligible POSTs inside processTenantRequest.
    if (config.session.inactivityTimeoutMinutes > 0) {
      const activity = await checkSessionActivity(
        projectId,
        c.req.header('cookie') ?? undefined,
        config.session.inactivityTimeoutMinutes,
      );
      if (!activity.active) {
        return c.json(
          { code: 'session_inactive', message: activity.reason ?? 'session expired due to inactivity' },
          401,
        );
      }
    }

    // Security checks + callback rewriting in one pass.
    const processed = await processTenantRequest(c.req.raw, projectId, config, clientIp);
    if (processed instanceof Response) {
      // A security check failed — return the error response directly.
      return processed;
    }

    const response = await runWithRequestContext({ ip, projectId, userAgent: c.req.header('user-agent') }, () =>
      instance.betterAuth.handler(processed),
    );

    // Touch session activity on successful responses so idle tracking
    // stays fresh. Fire-and-forget — never blocks the response.
    if (config.session.inactivityTimeoutMinutes > 0 && response.status < 400) {
      void touchSessionActivity(projectId, c.req.header('cookie') ?? undefined);
    }

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

// ─── Phase 6.1 — Auth Dashboard Team Seats ────────────────────────────────

/**
 * List auth team members for a project. Owners and auth team admins can read.
 */
authServiceRouter.get('/v1/projects/:id/auth/team', async (c) => {
  const projectId = c.req.param('id');
  if (!projectId) return c.json({ code: 'validation_failed' }, 400);
  const members = await listAuthTeamMembers(projectId);
  return c.json({ members });
});

const inviteTeamMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'viewer']).default('viewer'),
});

/**
 * Invite a user to the auth dashboard team by email. Owner-only.
 * If the user exists they are added immediately; otherwise the caller
 * should invite them to the project first.
 */
authServiceRouter.post(
  '/v1/projects/:id/auth/team',
  requireProjectRole('owner'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);

    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = inviteTeamMemberSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
    }

    const target = await findUserByEmail(parsed.data.email);
    if (!target) {
      return c.json(
        { code: 'user_not_found', message: 'no registered user with this email; invite them to the project first' },
        404,
      );
    }

    const added = await addAuthTeamMember({
      projectId,
      userId: target.id,
      role: parsed.data.role,
      invitedBy: actor.id,
    });

    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.team.invite',
      ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { invitedUserId: target.id, role: parsed.data.role },
    });

    return c.json({ member: added }, 201);
  },
);

/**
 * Remove a user from the auth dashboard team. Owner-only.
 */
authServiceRouter.delete(
  '/v1/projects/:id/auth/team/:userId',
  requireProjectRole('owner'),
  async (c) => {
    const projectId = c.req.param('id');
    const userId = c.req.param('userId');
    if (!projectId || !userId) return c.json({ code: 'validation_failed' }, 400);

    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);

    await removeAuthTeamMember(projectId, userId);

    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.team.remove',
      ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { removedUserId: userId },
    });

    return c.json({ ok: true });
  },
);

// ─── Phase 6.2 — User Impersonation ───────────────────────────────────────

/**
 * Start impersonating a user. Auth team admins can create a short-lived
 * session for a target user. Returns a session token the dashboard can set
 * as a cookie to act on the user's behalf.
 */
authServiceRouter.post(
  '/v1/projects/:id/auth/impersonate',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);

    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);

    const body = await c.req.json().catch(() => null);
    const targetUserId = body && typeof body === 'object' ? (body as Record<string, unknown>).userId : null;
    if (typeof targetUserId !== 'string') {
      return c.json({ code: 'validation_failed', message: 'missing userId' }, 400);
    }

    const { sessionToken, expiresAt } = await createImpersonationSession(
      projectId,
      targetUserId,
      actor.id,
    );

    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.impersonate.start',
      ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { targetUserId },
    });

    return c.json({ sessionToken, expiresAt: expiresAt.toISOString() });
  },
);

/**
 * Stop impersonating — revokes the impersonation session and records
 * the stop event in the tenant audit log.
 */
authServiceRouter.post(
  '/v1/projects/:id/auth/impersonate/stop',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);

    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);

    const body = await c.req.json().catch(() => null);
    const sessionToken = body && typeof body === 'object' ? (body as Record<string, unknown>).sessionToken : null;
    if (typeof sessionToken !== 'string') {
      return c.json({ code: 'validation_failed', message: 'missing sessionToken' }, 400);
    }

    await stopImpersonationSession(projectId, sessionToken, actor.id);

    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.impersonate.stop',
      ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: {},
    });

    return c.json({ ok: true });
  },
);

/**
 * Check whether the current session is an active impersonation session.
 * Customer-facing — called by the SDK to show an impersonation banner.
 */
authServiceRouter.get('/v1/auth-tenant/impersonation', async (c) => {
  const projectId = resolveTenant(c);
  if (!projectId) return c.json({ code: 'tenant_unresolved' }, 400);

  const cookieHeader = c.req.header('cookie') ?? '';
  const match = cookieHeader.match(/briven_auth_session_token=([^;]+)/);
  const sessionToken = match?.[1] ?? null;
  if (!sessionToken) {
    return c.json({ impersonating: false });
  }

  const active = await getActiveImpersonation(projectId, sessionToken);
  if (!active) {
    return c.json({ impersonating: false });
  }

  return c.json({
    impersonating: true,
    impersonatedBy: active.impersonatedBy,
    targetUserId: active.targetUserId,
  });
});

// ─── Phase 6.3 — Application Logs ─────────────────────────────────────────

authServiceRouter.get(
  '/v1/projects/:id/auth/app-logs',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);

    const level = c.req.query('level') as 'error' | 'warn' | 'info' | undefined;
    const action = c.req.query('action') ?? undefined;
    const cursor = c.req.query('cursor') ?? null;
    const limitRaw = c.req.query('limit');
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

    const result = await listAppLogs(projectId, {
      level,
      action,
      cursor,
      limit: Number.isFinite(limit!) ? limit : undefined,
    });
    return c.json(result);
  },
);

/**
 * Admin trigger to purge old logs immediately. Normally the janitor
 * handles this on schedule; this endpoint is for manual cleanup or
 * testing retention changes.
 */
authServiceRouter.post(
  '/v1/projects/:id/auth/app-logs/purge',
  requireProjectRole('owner'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);

    const config = await getAuthConfig(projectId);
    const [appResult, auditResult] = await Promise.all([
      purgeOldAppLogs(projectId, config.retention.appLogDays),
      purgeOldAuditLogs(projectId, config.retention.auditLogDays),
    ]);

    return c.json({
      appLogsDeleted: appResult.deleted,
      auditLogsDeleted: auditResult.deleted,
      retention: config.retention,
    });
  },
);

// ─── Phase 6.6 — Compliance Groundwork ────────────────────────────────────

authServiceRouter.get(
  '/v1/projects/:id/auth/compliance',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    const settings = await getComplianceSettings(projectId);
    return c.json({ compliance: settings });
  },
);

authServiceRouter.patch(
  '/v1/projects/:id/auth/compliance',
  requireProjectRole('owner'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);

    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Partial<{
      soc2ControlsUrl: string | null;
      hipaaBaaSignedAt: string | null;
      hipaaBaaSignedBy: string | null;
      gdprDpaSignedAt: string | null;
      gdprDpaSignedBy: string | null;
      encryptionAtRestEnabled: boolean;
    }> = {};

    if (body.soc2ControlsUrl !== undefined) patch.soc2ControlsUrl = typeof body.soc2ControlsUrl === 'string' ? body.soc2ControlsUrl : null;
    if (body.hipaaBaaSignedAt !== undefined) patch.hipaaBaaSignedAt = typeof body.hipaaBaaSignedAt === 'string' ? body.hipaaBaaSignedAt : null;
    if (body.hipaaBaaSignedBy !== undefined) patch.hipaaBaaSignedBy = typeof body.hipaaBaaSignedBy === 'string' ? body.hipaaBaaSignedBy : null;
    if (body.gdprDpaSignedAt !== undefined) patch.gdprDpaSignedAt = typeof body.gdprDpaSignedAt === 'string' ? body.gdprDpaSignedAt : null;
    if (body.gdprDpaSignedBy !== undefined) patch.gdprDpaSignedBy = typeof body.gdprDpaSignedBy === 'string' ? body.gdprDpaSignedBy : null;
    if (body.encryptionAtRestEnabled !== undefined) patch.encryptionAtRestEnabled = Boolean(body.encryptionAtRestEnabled);

    const settings = await setComplianceSettings(projectId, patch);
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.compliance.update',
      ipHash: hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { fields: Object.keys(patch) },
    });
    return c.json({ compliance: settings });
  },
);

/** Full enterprise sales kit (DPA/BAA/retention templates + project status). */
authServiceRouter.get(
  '/v1/projects/:id/auth/compliance/pack',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    const pack = await buildEnterpriseSalesPack(projectId, env.BRIVEN_API_ORIGIN);
    return c.json(pack);
  },
);

authServiceRouter.post(
  '/v1/projects/:id/auth/compliance/sign-dpa',
  requireProjectRole('owner'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { signedBy?: string };
    const signedBy = typeof body.signedBy === 'string' && body.signedBy.trim()
      ? body.signedBy.trim()
      : actor.email ?? actor.id;
    const compliance = await signGdprDpa(projectId, signedBy);
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.compliance.dpa_signed',
      metadata: { signedBy },
    });
    return c.json({ compliance });
  },
);

authServiceRouter.post(
  '/v1/projects/:id/auth/compliance/sign-baa',
  requireProjectRole('owner'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { signedBy?: string };
    const signedBy = typeof body.signedBy === 'string' && body.signedBy.trim()
      ? body.signedBy.trim()
      : actor.email ?? actor.id;
    const compliance = await signHipaaBaa(projectId, signedBy);
    await audit({
      actorId: actor.id,
      projectId,
      action: 'auth.compliance.baa_signed',
      metadata: { signedBy },
    });
    return c.json({ compliance });
  },
);

// ─── SCIM group → org role maps (Phase 9.2) ───────────────────────────────

authServiceRouter.get(
  '/v1/projects/:id/auth/scim/role-maps',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    const items = await listScimRoleMaps(projectId);
    return c.json({ items });
  },
);

authServiceRouter.put(
  '/v1/projects/:id/auth/scim/role-maps',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    const body = (await c.req.json().catch(() => null)) as {
      displayName?: string;
      orgId?: string;
      role?: string;
    } | null;
    if (!body?.displayName || !body?.orgId) {
      return c.json({ code: 'validation_failed', message: 'displayName and orgId required' }, 400);
    }
    try {
      const item = await upsertScimRoleMap(projectId, {
        displayName: body.displayName,
        orgId: body.orgId,
        role: body.role,
      });
      await audit({
        actorId: actor.id,
        projectId,
        action: 'briven_auth.scim_role_map.upsert',
        metadata: { mapId: item.id, orgId: item.orgId },
      });
      return c.json({ item });
    } catch (err) {
      return c.json(
        { code: 'validation_failed', message: err instanceof Error ? err.message : 'failed' },
        400,
      );
    }
  },
);

authServiceRouter.delete(
  '/v1/projects/:id/auth/scim/role-maps/:mapId',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const mapId = c.req.param('mapId');
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    try {
      await deleteScimRoleMap(projectId, mapId);
      await audit({
        actorId: actor.id,
        projectId,
        action: 'briven_auth.scim_role_map.deleted',
        metadata: { mapId },
      });
      return c.json({ ok: true });
    } catch {
      return c.json({ code: 'not_found' }, 404);
    }
  },
);

// ─── Phase 7.1 — JWT Templates ────────────────────────────────────────────

authServiceRouter.get(
  '/v1/projects/:id/auth/jwt/templates',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    const templates = await listJwtTemplates(projectId);
    return c.json({ templates });
  },
);

authServiceRouter.post(
  '/v1/projects/:id/auth/jwt/templates',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      claims?: Record<string, unknown>;
    };
    if (!body.name || typeof body.name !== 'string' || body.name.length < 1 || body.name.length > 64) {
      return c.json({ code: 'validation_failed', message: 'name must be 1-64 characters' }, 400);
    }
    if (!body.claims || typeof body.claims !== 'object') {
      return c.json({ code: 'validation_failed', message: 'claims must be an object' }, 400);
    }
    await createJwtTemplate(projectId, body.name, body.claims);
    return c.json({ ok: true });
  },
);

authServiceRouter.delete(
  '/v1/projects/:id/auth/jwt/templates/:name',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const name = c.req.param('name');
    if (!projectId || !name) return c.json({ code: 'validation_failed' }, 400);
    await deleteJwtTemplate(projectId, name);
    return c.json({ ok: true });
  },
);

// ─── Phase 7.4 — Testing Tokens ───────────────────────────────────────────

authServiceRouter.get(
  '/v1/projects/:id/auth/test-tokens',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    const tokens = await listTestTokens(projectId);
    return c.json({ tokens });
  },
);

authServiceRouter.post(
  '/v1/projects/:id/auth/test-tokens',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { userId?: string; name?: string };
    if (!body.userId) {
      return c.json({ code: 'validation_failed', message: 'userId required' }, 400);
    }
    const token = await createTestToken(projectId, body.userId, body.name);
    return c.json({ token: token.token, expiresAt: token.expiresAt.toISOString() });
  },
);

authServiceRouter.delete(
  '/v1/projects/:id/auth/test-tokens/:tokenId',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const tokenId = c.req.param('tokenId');
    if (!projectId || !tokenId) return c.json({ code: 'validation_failed' }, 400);
    await revokeTestToken(projectId, tokenId);
    return c.json({ ok: true });
  },
);

// ─── Phase 7.5 — Email Template Customization ─────────────────────────────

authServiceRouter.get(
  '/v1/projects/:id/auth/email-templates',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    const templates = await listEmailTemplates(projectId);
    return c.json({ templates });
  },
);

authServiceRouter.put(
  '/v1/projects/:id/auth/email-templates',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      subject?: string;
      html?: string;
      text?: string | null;
    };
    if (!body.name || !EMAIL_TEMPLATE_NAMES.includes(body.name as EmailTemplateName)) {
      return c.json({ code: 'validation_failed', message: `name must be one of ${EMAIL_TEMPLATE_NAMES.join(', ')}` }, 400);
    }
    if (!body.subject || typeof body.subject !== 'string') {
      return c.json({ code: 'validation_failed', message: 'subject required' }, 400);
    }
    if (!body.html || typeof body.html !== 'string') {
      return c.json({ code: 'validation_failed', message: 'html required' }, 400);
    }
    await setEmailTemplate(projectId, {
      name: body.name as EmailTemplateName,
      subject: body.subject,
      html: body.html,
      text: body.text,
    });
    return c.json({ ok: true });
  },
);

authServiceRouter.delete(
  '/v1/projects/:id/auth/email-templates/:name',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const name = c.req.param('name');
    if (!projectId || !name) return c.json({ code: 'validation_failed' }, 400);
    if (!EMAIL_TEMPLATE_NAMES.includes(name as EmailTemplateName)) {
      return c.json({ code: 'validation_failed', message: `name must be one of ${EMAIL_TEMPLATE_NAMES.join(', ')}` }, 400);
    }
    await deactivateEmailTemplate(projectId, name as EmailTemplateName);
    return c.json({ ok: true });
  },
);

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
