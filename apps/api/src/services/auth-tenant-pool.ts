import { randomBytes } from 'node:crypto';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

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
 *   - cache miss opens a per-project MySQL pool with `database` locked
 *     to `proj_<projectId>` at pool creation, wraps it in a Drizzle
 *     client, and constructs a `betterAuth({...})` instance
 *   - cache hit returns the warm instance
 *   - eviction (idle, LRU, or forced) closes the per-project MySQL
 *     pool via `closePool()` so connections are released
 *
 * @README-DOLT ADR 0001 — migrated from postgres-js to mysql2.
 *
 *   - `postgres(url, { connection: { search_path } })` →
 *     `mysql.createPool({ uri: url, database: dbName })`
 *     MySQL's `database` pool option sets the default database for all
 *     connections — same effect as Postgres `search_path`.
 *   - `drizzle-orm/postgres-js` → `drizzle-orm/mysql2`
 *   - `provider: 'pg'` → `provider: 'mysql'`
 *   - `sql.end({ timeout: 5 })` → `pool.end()`
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
  if (!env.BRIVEN_DOLT_URL) {
    throw new Error('BRIVEN_DOLT_URL not configured — briven auth cannot bind a database');
  }
  const db = dbNameFor(projectId);

  // Per-project MySQL pool. `database` sets the default database for
  // every connection in this pool — the equivalent of Postgres
  // `connection.search_path`. All queries, including those issued by
  // Better Auth's Drizzle adapter outside our transaction boundaries,
  // land in the correct project database.
  const sql = mysql.createPool({
    uri: env.BRIVEN_DOLT_URL,
    connectionLimit: 5,
    idleTimeout: 30000,
    connectTimeout: 5000,
    database: db,
  });
  const drizzleDb = drizzle(sql);

  const instance = betterAuth({
    appName: `briven-auth-${projectId}`,
    secret: authSecret(),
    baseURL: env.BRIVEN_API_ORIGIN,
    // Distinct from control-plane Better Auth (which owns `/v1/auth/*`
    // for the briven.tech dashboard login). Customer-facing tenant auth
    // claims `/v1/auth-tenant/*` so the two engines don't collide in
    // Hono routing. SDK + hosted-pages both target this prefix.
    basePath: '/v1/auth-tenant',
    database: drizzleAdapter(drizzleDb, {
      provider: 'mysql',
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
    },
  });

  return {
    betterAuth: instance,
    closePool: async () => {
      await sql.end();
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
