import { randomBytes } from 'node:crypto';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { authSchema } from '../db/auth-customer-schema.js';
import { dbNameFor } from '../db/data-plane.js';
import { env } from '../env.js';
import { log } from '../lib/logger.js';
import {
  sendBrivenAuthEmailVerification,
  sendBrivenAuthPasswordReset,
} from './auth-mailer.js';
import { TenantInstancePool } from './tenant-instance-pool.js';

/**
 * Per-tenant Better Auth instance pool — the briven auth-specific factory
 * that wires `TenantInstancePool` + Drizzle + Better Auth into a working
 * customer-facing instance per project.
 *
 * Lifecycle (ARCHITECTURE.md §3):
 *   - first `getAuthInstance(projectId)` lazily creates the pool
 *   - cache miss opens a per-project `pg` pool bound to the project's own
 *     DoltGres DATABASE (`proj_<id>`), wraps it in a Drizzle client, and
 *     constructs a `betterAuth({...})` instance
 *   - cache hit returns the warm instance
 *   - eviction (idle, LRU, or forced) closes the per-project pool via
 *     `closePool()` so connections are released
 *
 * Tenancy: database-per-project (ADR 0001). The auth tables live in the
 * project's own database `public` schema, so binding the pool to that
 * database is enough — no `search_path` pinning, and no schema-per-project.
 * Uses `pg` (node-postgres), not postgres.js, which desyncs with DoltGres.
 *
 * v0 provider configuration: email + password only. OAuth providers,
 * magic link, OTP, and passkeys land in the next step once the per-tenant
 * config storage + mittera mailer wiring are in place (BUILD_PLAN.md
 * §13 step 4).
 */

/**
 * Type inferred from the factory's return rather than declared explicitly.
 * Better Auth's `Auth<TOptions>` is invariant in its generic parameter, so
 * a hand-written `ReturnType<typeof betterAuth>` widens to
 * `Auth<BetterAuthOptions>` and refuses assignment from the narrow
 * inferred type of our specific call. Letting TypeScript derive the
 * type keeps the precise inference all the way through the pool.
 */
export type BrivenAuthInstance = Awaited<ReturnType<typeof createAuthInstance>>;

let pool: TenantInstancePool<BrivenAuthInstance> | null = null;
let processSecret: string | null = null;

/**
 * Resolve the Better Auth signing secret. Same fallback chain as the
 * control-plane auth (`apps/api/src/lib/auth.ts`): real env value in
 * prod, ephemeral per-process in dev.
 */
function authSecret(): string {
  if (env.BRIVEN_BETTER_AUTH_SECRET) return env.BRIVEN_BETTER_AUTH_SECRET;
  if (env.BRIVEN_ENV !== 'development') {
    throw new Error(
      'BRIVEN_BETTER_AUTH_SECRET is required outside development for briven auth',
    );
  }
  if (!processSecret) {
    processSecret = randomBytes(32).toString('hex');
    log.warn('briven_auth_ephemeral_secret', {
      reason: 'dev-only fallback — sessions will not survive restart',
    });
  }
  return processSecret;
}

async function createAuthInstance(projectId: string) {
  if (!env.BRIVEN_DATA_PLANE_URL) {
    throw new Error('BRIVEN_DATA_PLANE_URL not configured — briven auth cannot bind a database');
  }

  // Per-project pg (node-postgres) pool bound to the project's OWN DoltGres
  // DATABASE (proj_<id>) — database-per-project, mirroring data-plane.ts and
  // apps/runtime/src/db.ts. Two reasons this replaced postgres.js + a
  // search_path schema (ADR 0001 / sprint S2.1):
  //   1. postgres.js's extended-protocol pipelining desyncs with DoltGres
  //      (`unhandled message "&{}"`); `pg` works reliably.
  //   2. The model is database-per-project, not schema-per-project, so the
  //      auth tables live in this database's `public` schema — no search_path
  //      pinning is needed (the connection is already bound to the right DB).
  const base = new URL(env.BRIVEN_DATA_PLANE_URL);
  const pgPool = new pg.Pool({
    host: base.hostname,
    port: Number(base.port || 5432),
    user: decodeURIComponent(base.username),
    password: decodeURIComponent(base.password),
    database: dbNameFor(projectId),
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  const db = drizzle(pgPool);

  // ──────────────────────────────────────────────────────────────────────
  // TODO(konnos / tenant OAuth wiring): wire customer-configured OAuth
  // providers into this per-tenant instance.
  //
  // STATUS: deferred — NOT yet wired for ANY provider. This factory
  // currently builds email+password only; `getAuthConfig(projectId)` is not
  // read here, so the per-project provider toggles (google/github/discord/
  // microsoft/konnos) stored via tenant-config-store are persisted + shown
  // in the dashboard but do not yet reach the Better Auth engine. The whole
  // tenant-OAuth path (config-aware factory + per-tenant client-secret
  // load) is a follow-up step (BUILD_PLAN.md §13 step 4 / §6).
  //
  // When building it, konnos is a GENERIC OIDC/OAuth provider (Forgejo at
  // code.konnos.org) and must be wired via Better Auth's `genericOAuth`
  // plugin (`import { genericOAuth } from 'better-auth/plugins'`) — NOT a
  // built-in socialProvider. Copy the PROVEN control-plane pattern in
  // apps/api/src/lib/auth.ts (lines ~204-228), but source the values
  // per-tenant instead of from env:
  //   const config = await getAuthConfig(projectId);
  //   ...(config.providers.konnos.enabled && config.providers.konnos.clientId
  //     ? [genericOAuth({ config: [{
  //         providerId: 'konnos',
  //         clientId: config.providers.konnos.clientId,
  //         clientSecret: <decryptTenantSecret({ service: 'auth', projectId,
  //                          ciphertext: <stored konnos secret> })>,
  //         // discovery (Forgejo supports OIDC):
  //         //   discoveryUrl: 'https://code.konnos.org/.well-known/openid-configuration'
  //         // or explicit endpoints (gitea-compatible, as lib/auth.ts uses):
  //         authorizationUrl: 'https://code.konnos.org/login/oauth/authorize',
  //         tokenUrl:         'https://code.konnos.org/login/oauth/access_token',
  //         userInfoUrl:      'https://code.konnos.org/api/v1/user',
  //         scopes: ['openid', 'profile', 'email'],
  //         mapProfileToUser: (p) => ({ id: String(p.id), email: p.email,
  //           name: p.full_name || p.login, image: p.avatar_url, emailVerified: true }),
  //       }] })]
  //     : [])
  // BLOCKER: the per-tenant OAuth client-SECRET load is not built yet. The
  // primitive exists (tenant-secret-store.ts encrypt/decryptTenantSecret,
  // service 'auth'), but there is no write endpoint nor a stored-key
  // convention for OAuth client secrets — the provider-toggles UI itself
  // notes "client secret: configure separately (encrypted endpoint)" which
  // "lands in the next iteration". Wire konnos here once that secret path
  // exists, gating on enabled + clientId + secret-present, exactly like the
  // env-gated conditional in lib/auth.ts. The same plumbing then enables the
  // built-in socialProviders (google/github/discord/microsoft) too.
  // ──────────────────────────────────────────────────────────────────────

  const instance = betterAuth({
    appName: `briven-auth-${projectId}`,
    secret: authSecret(),
    baseURL: env.BRIVEN_API_ORIGIN,
    // Distinct from control-plane Better Auth (which owns `/v1/auth/*`
    // for the briven.tech dashboard login). Customer-facing tenant auth
    // claims `/v1/auth-tenant/*` so the two engines don't collide in
    // Hono routing. SDK + hosted-pages both target this prefix.
    basePath: '/v1/auth-tenant',
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: authSchema.user,
        session: authSchema.session,
        account: authSchema.account,
        verification: authSchema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: env.BRIVEN_ENV === 'production',
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
      sendResetPassword: async ({ user, url }) => {
        await sendBrivenAuthPasswordReset(projectId, user.email, url);
      },
    },
    emailVerification: {
      sendOnSignUp: env.BRIVEN_ENV === 'production',
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendBrivenAuthEmailVerification(projectId, user.email, url);
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24 * 7, // refresh if older than 7 days
    },
    advanced: {
      cookiePrefix: 'briven-auth',
      useSecureCookies: env.BRIVEN_ENV === 'production',
      defaultCookieAttributes: {
        sameSite: 'lax',
        httpOnly: true,
      },
      // Privacy (CLAUDE.md §5.1): never persist raw end-user IPs. The
      // session.ip_address column exists for Better-Auth compatibility but
      // stays null. (Add hashed-IP-on-write later if device tracking is wanted.)
      ipAddress: {
        disableIpTracking: true,
      },
    },
  });

  return {
    betterAuth: instance,
    closePool: async () => {
      await pgPool.end();
    },
  };
}

function getPool(): TenantInstancePool<BrivenAuthInstance> {
  if (!pool) {
    pool = new TenantInstancePool<BrivenAuthInstance>({
      maxSize: 256,
      idleTtlMs: 10 * 60 * 1000, // 10 minutes
      factory: createAuthInstance,
      onEvict: async (projectId, instance) => {
        await instance.closePool();
        log.info('briven_auth_instance_evicted', { projectId });
      },
      onEvictError: (projectId, err) => {
        log.warn('briven_auth_instance_evict_failed', {
          projectId,
          message: err instanceof Error ? err.message : String(err),
        });
      },
    });
  }
  return pool;
}

/**
 * Fetch (or create) the Better Auth instance for a project. Cached for
 * 10 minutes of idle time; LRU cap at 256 instances per api process.
 */
export function getAuthInstance(projectId: string): Promise<BrivenAuthInstance> {
  return getPool().get(projectId);
}

/**
 * Force-evict a project's instance. Called by the dashboard's
 * config-update handlers so the next request sees fresh state — e.g.
 * after a customer toggles an OAuth provider or rotates a webhook secret.
 */
export function invalidateAuthInstance(projectId: string): Promise<void> {
  if (!pool) return Promise.resolve();
  return pool.evict(projectId);
}

/**
 * Drop every cached instance. Test + graceful-shutdown hook.
 */
export async function clearAuthInstancePool(): Promise<void> {
  if (!pool) return;
  await pool.clear();
}

/**
 * Current pool size. Returns 0 before any tenant has been touched.
 */
export function authInstancePoolSize(): number {
  return pool?.size ?? 0;
}

/**
 * Visible for tests — replace the pool factory with a synthetic one so
 * test files can exercise the lifecycle without a real postgres + Better
 * Auth roundtrip.
 */
export function __unsafe_setAuthInstancePool_forTesting(
  next: TenantInstancePool<BrivenAuthInstance> | null,
): void {
  pool = next;
}
