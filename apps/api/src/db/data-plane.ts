import pg from 'pg';
import postgres from 'postgres';

import { env } from '../env.js';
import { log } from '../lib/logger.js';

/**
 * Lazily-opened admin connection for the shared data-plane cluster
 * (`BRIVEN_DATA_PLANE_URL`). Used for DoltGres database provisioning /
 * teardown and readiness pings.
 *
 * @README-BRIVEN ADR 0001 — the converged data plane is DoltGres, which works
 * with the `pg` driver (node-postgres) but NOT postgres.js (postgres.js's
 * extended-protocol pipelining desyncs against DoltGres). So the admin path
 * here uses `pg`. The control plane (apps/api/src/db/client.ts + drizzle)
 * stays on postgres.js — it talks to real Postgres, not DoltGres.
 */
let _client: pg.Pool | null = null;

function client(): pg.Pool {
  if (!env.BRIVEN_DATA_PLANE_URL) {
    throw new Error('BRIVEN_DATA_PLANE_URL is not configured');
  }
  if (!_client) {
    _client = new pg.Pool({
      connectionString: env.BRIVEN_DATA_PLANE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    log.info('data_plane_connected', { max: 20 });
  }
  return _client;
}

/**
 * Lazily-opened postgres.js client kept ONLY for the legacy schema-per-project
 * model functions below (`provisionProjectRole`, `rotateProjectRolePassword`,
 * and studio/snapshots/usage via `dataPlaneClient()`). These are slated for
 * Stage-2 removal; rather than port their heavy postgres.js tagged-template /
 * `.unsafe` usage to `pg`, we keep them on a thin postgres.js wrapper so the
 * build stays green. New data-plane work must use `client()` (pg) — see
 * `runInProjectDatabase` for the database-per-project transaction path.
 */
let _pgjs: postgres.Sql | null = null;

function pgjsClient(): postgres.Sql {
  if (!env.BRIVEN_DATA_PLANE_URL) {
    throw new Error('BRIVEN_DATA_PLANE_URL is not configured');
  }
  if (!_pgjs) {
    _pgjs = postgres(env.BRIVEN_DATA_PLANE_URL, {
      max: 20,
      idle_timeout: 30,
      connect_timeout: 5,
      prepare: false,
    });
  }
  return _pgjs;
}

/**
 * Map a `projectId` (e.g. `p_01HZ...`) to the Postgres schema name we
 * provision for it. We strip the prefix (which contains characters
 * unfriendly to identifiers) and prefix `proj_` so the bare project id
 * remains visible to operators reading `pg_namespace`.
 */
export function schemaNameFor(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  // Postgres identifiers max 63 bytes; our prefix + ULID is well under that.
  return `proj_${safe}`;
}

/**
 * Map a `projectId` to the DoltGres DATABASE name we provision for it.
 *
 * We are converging the platform onto database-per-project (each project
 * gets its own DoltGres database so it has an independent commit history /
 * branch namespace, and realtime change-detection is scoped per database).
 *
 * Mirror of `apps/runtime/src/db.ts:dbNameFor` and the realtime copies —
 * all sides derive the database name deterministically from the project id
 * so the name never has to be shipped in a request payload. The sanitize is
 * identical to `schemaNameFor` (kept separate so the schema path can be
 * removed in a later cleanup stage without touching this).
 */
export function dbNameFor(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return `proj_${safe}`;
}

/**
 * Postgres role that owns day-to-day CRUD on a project's schema. Granted at
 * provision time; password is rotated on every `briven db shell` request.
 */
export function roleNameFor(projectId: string): string {
  return `${schemaNameFor(projectId)}_owner`;
}

/**
 * Provision a dedicated DoltGres DATABASE for a new project and create the
 * platform bookkeeping tables inside it. Idempotent — safe to call on retry.
 *
 * This is the database-per-project replacement for `provisionProjectSchema`.
 * Each project needs an independent DoltGres commit history / branch
 * namespace, which is per-DATABASE, not per-schema — hence a real database
 * rather than a Postgres schema.
 *
 * Notes:
 *  - `CREATE DATABASE` cannot run inside a transaction, so we issue it as a
 *    bare statement (never via `sql.begin`).
 *  - DoltGres may not support `IF NOT EXISTS` on `CREATE DATABASE`, so we
 *    guard idempotency by checking `pg_database` first (mirrors how the role
 *    DO-block guards against `pg_roles`).
 *  - The `_briven_` bookkeeping tables now live unqualified inside the
 *    project's own database (no schema prefix), reusing the same DDL the
 *    schema path used.
 */
export async function provisionProjectDatabase(projectId: string): Promise<string> {
  const url = env.BRIVEN_DATA_PLANE_URL;
  if (!url) {
    throw new Error('BRIVEN_DATA_PLANE_URL is not configured');
  }
  const dbName = dbNameFor(projectId);
  const admin = client();

  // Guard: CREATE DATABASE is not reliably idempotent on DoltGres, and it
  // cannot run inside a transaction — so check pg_database, then issue a
  // bare CREATE only if absent.
  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (existing.rows.length === 0) {
    await admin.query(`CREATE DATABASE "${dbName}"`);
  }

  // Second pool bound to the freshly-created database. Small pool — this is
  // only used for one-shot provisioning DDL, then ended. Parse the base URL
  // once and override the database field (DoltGres can't switch DB mid-conn).
  const base = new URL(url);
  const projPool = new pg.Pool({
    host: base.hostname,
    port: Number(base.port || 5432),
    user: decodeURIComponent(base.username),
    password: decodeURIComponent(base.password),
    database: dbName,
    max: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  try {
    await projPool.query(`
      CREATE TABLE IF NOT EXISTS "_briven_migrations" (
        id text PRIMARY KEY,
        deployment_id text,
        applied_at timestamptz NOT NULL DEFAULT now(),
        summary jsonb
      )
    `);
    await projPool.query(`
      CREATE TABLE IF NOT EXISTS "_briven_meta" (
        key text PRIMARY KEY,
        value jsonb NOT NULL
      )
    `);
  } finally {
    await projPool.end();
  }

  log.info('project_database_provisioned', { projectId, dbName });
  return dbName;
}

/**
 * Drop a project's DoltGres database (used for create-time rollback and,
 * later, soft-delete GC). `DROP DATABASE` also cannot run inside a
 * transaction; issued as a bare statement.
 */
export async function dropProjectDatabase(projectId: string): Promise<void> {
  const dbName = dbNameFor(projectId);
  const admin = client();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  log.warn('project_database_dropped', { projectId, dbName });
}

/**
 * Create the project's scoped login role and grant CRUD inside its schema.
 * Called at project creation and lazily at shell-token issue time for
 * projects that pre-date this feature.
 */
export async function provisionProjectRole(projectId: string): Promise<void> {
  const schema = schemaNameFor(projectId);
  const role = roleNameFor(projectId);
  const sql = pgjsClient();
  // CREATE ROLE is not idempotent via IF NOT EXISTS; use a DO block.
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
        EXECUTE 'CREATE ROLE "${role}" WITH LOGIN NOINHERIT PASSWORD NULL';
      END IF;
    END
    $$;
  `);
  await sql.unsafe(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
  await sql.unsafe(`GRANT ALL ON ALL TABLES IN SCHEMA "${schema}" TO "${role}"`);
  await sql.unsafe(`GRANT ALL ON ALL SEQUENCES IN SCHEMA "${schema}" TO "${role}"`);
  await sql.unsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT ALL ON TABLES TO "${role}"`,
  );
  await sql.unsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT ALL ON SEQUENCES TO "${role}"`,
  );
  // Platform tables: readable by platform, never writable by the user.
  await sql.unsafe(`REVOKE ALL ON TABLE "${schema}"."_briven_migrations" FROM "${role}"`);
  await sql.unsafe(`REVOKE ALL ON TABLE "${schema}"."_briven_meta" FROM "${role}"`);
}

/**
 * Rotate the project role's password to a short-lived random value and
 * return the plaintext + expiry. The caller constructs a DSN from these and
 * never writes them to logs.
 */
export async function rotateProjectRolePassword(
  projectId: string,
  ttlSeconds: number,
): Promise<{ role: string; password: string; expiresAt: Date }> {
  await provisionProjectRole(projectId);
  const role = roleNameFor(projectId);
  const password = randomPassword(32);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const sql = pgjsClient();
  // Identifier quoting via pg_ident escape: we generated `role` ourselves,
  // so it's safe; password is bound via postgres.js parameter binding.
  await sql.unsafe(`ALTER ROLE "${role}" WITH PASSWORD $1 VALID UNTIL $2`, [
    password,
    expiresAt.toISOString(),
  ]);
  return { role, password, expiresAt };
}

function randomPassword(bytes: number): string {
  // Hex-encoded random bytes — safe in every DSN, never contains chars
  // needing URL-encoding.
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The minimal transaction adapter handed to `fn` inside
 * `runInProjectDatabase`. Mirrors the runtime's `ProjectTx`
 * (`apps/runtime/src/db.ts`): a single `unsafe(text, params?)` that resolves
 * to the result rows directly — the same shape postgres.js's `tx.unsafe`
 * returned, so callers that used `.unsafe(...)` migrate without rewrites.
 */
export interface ProjectTx {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unsafe(text: string, params?: readonly unknown[]): Promise<any[]>;
}

/**
 * Per-project `pg.Pool` cache, each bound to that project's own DoltGres
 * DATABASE (`proj_<id>`). Built from the parsed `BRIVEN_DATA_PLANE_URL` with
 * the `database` field overridden (DoltGres can't switch DB mid-connection),
 * exactly like `provisionProjectDatabase`'s second client.
 */
const _projPools = new Map<string, pg.Pool>();

function poolFor(projectId: string): pg.Pool {
  const url = env.BRIVEN_DATA_PLANE_URL;
  if (!url) {
    throw new Error('BRIVEN_DATA_PLANE_URL is not configured');
  }
  const dbName = dbNameFor(projectId);
  let pool = _projPools.get(dbName);
  if (!pool) {
    const base = new URL(url);
    pool = new pg.Pool({
      host: base.hostname,
      port: Number(base.port || 5432),
      user: decodeURIComponent(base.username),
      password: decodeURIComponent(base.password),
      database: dbName,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    _projPools.set(dbName, pool);
    log.info('project_db_pool_opened', { projectId, dbName });
  }
  return pool;
}

/**
 * Run an arbitrary SQL string inside the project's OWN DoltGres database.
 *
 * This is the database-per-project replacement for the legacy
 * `runInProjectSchema` (schema-per-tenant on a shared database). No
 * `search_path` is set — the connection is already bound to the project's
 * dedicated database, so unqualified identifiers resolve to the project's
 * tables directly. Uses the `pg` driver (postgres.js desyncs against
 * DoltGres — see ADR 0001).
 *
 * Wraps `fn` in `BEGIN`/`COMMIT` (ROLLBACK on throw, release in finally).
 */
export async function runInProjectDatabase<T>(
  projectId: string,
  fn: (tx: ProjectTx) => Promise<T>,
): Promise<T> {
  const pool = poolFor(projectId);
  const conn = await pool.connect();
  const tx: ProjectTx = {
    unsafe: (text, params) =>
      conn.query(text, params ? [...params] : undefined).then((r) => r.rows),
  };
  try {
    await conn.query('BEGIN');
    const result = await fn(tx);
    await conn.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await conn.query('ROLLBACK');
    } catch {
      // A failed rollback must not mask the original error.
    }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Close every cached per-project database pool. Called on shutdown alongside
 * `closeDataPlane`.
 */
export async function closeProjectDbPools(): Promise<void> {
  const pools = Array.from(_projPools.values());
  _projPools.clear();
  await Promise.all(pools.map((p) => p.end()));
}

export function dataPlaneClient(): postgres.Sql {
  return pgjsClient();
}

export async function pingDataPlane(): Promise<boolean> {
  if (!env.BRIVEN_DATA_PLANE_URL) return false;
  try {
    await client().query('SELECT 1');
    return true;
  } catch (err) {
    log.warn('data_plane_ping_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function closeDataPlane(): Promise<void> {
  await closeProjectDbPools();
  if (_client) {
    await _client.end();
    _client = null;
  }
  if (_pgjs) {
    await _pgjs.end({ timeout: 5 });
    _pgjs = null;
  }
}
