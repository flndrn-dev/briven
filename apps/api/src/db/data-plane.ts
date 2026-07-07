import pg from 'pg';

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
 * Map a `projectId` to the DoltGres DATABASE name we provision for it.
 *
 * We are converging the platform onto database-per-project (each project
 * gets its own DoltGres database so it has an independent commit history /
 * branch namespace, and realtime change-detection is scoped per database).
 *
 * Mirror of `apps/runtime/src/db.ts:dbNameFor` and the realtime copies —
 * all sides derive the database name deterministically from the project id
 * so the name never has to be shipped in a request payload.
 */
export function dbNameFor(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  // Postgres identifiers max 63 bytes; our prefix + ULID is well under that.
  return `proj_${safe}`;
}

/**
 * Postgres role that owns day-to-day CRUD inside a project's own database.
 * Granted at provision time; password is rotated on every `briven db shell`
 * request. Derived from `dbNameFor` so the role tracks the project database.
 */
export function roleNameFor(projectId: string): string {
  return `${dbNameFor(projectId)}_owner`;
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
 * Create the project's scoped login role and grant CRUD inside the project's
 * OWN DoltGres database (database-per-project). Called at project creation and
 * lazily at shell-token issue time for projects that pre-date this feature.
 * Uses the `pg` driver (postgres.js desyncs against DoltGres — see ADR 0001).
 */
export async function provisionProjectRole(projectId: string): Promise<void> {
  const url = env.BRIVEN_DATA_PLANE_URL;
  if (!url) {
    throw new Error('BRIVEN_DATA_PLANE_URL is not configured');
  }
  const dbName = dbNameFor(projectId);
  const role = roleNameFor(projectId);
  const admin = client();

  // CREATE ROLE is cluster-global, so it MUST run on the admin connection
  // (default database), not inside the project database. DoltGres's role system
  // is incomplete: no plpgsql `DO $$...$$` guard, and `pg_roles` visibility is
  // unreliable across pooled connections — so neither IF NOT EXISTS nor a
  // check-then-create is dependable. Instead just attempt CREATE ROLE and treat
  // "already exists" as success (idempotent). Role name is generated by us.
  try {
    await admin.query(`CREATE ROLE "${role}" WITH LOGIN NOINHERIT PASSWORD NULL`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/already exists/i.test(msg)) throw err;
  }

  // The GRANTs apply to objects that live INSIDE the project's own database,
  // so they must run on a connection bound to that database and target the
  // `public` schema there (NOT a `proj_<id>` schema). Short-lived pool, same
  // pattern as provisionProjectDatabase's second client — parse the base URL
  // and override `database` (DoltGres can't switch DB mid-connection).
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
    await projPool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await projPool.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO "${role}"`);
    await projPool.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "${role}"`);
    // NOTE: `ALTER DEFAULT PRIVILEGES` is NOT supported on DoltGres ("not yet
    // supported"), so we can't auto-grant on FUTURE tables. Instead this whole
    // function re-runs on every shell-token issue (rotateProjectRolePassword →
    // provisionProjectRole), so the GRANT ALL ON ALL TABLES above re-covers any
    // tables created since the last issue. Acceptable for short-lived tokens.
    // Platform tables: readable by platform, never writable by the user. They
    // live unqualified in the project database's public schema.
    await projPool.query(`REVOKE ALL ON TABLE "_briven_migrations" FROM "${role}"`);
    await projPool.query(`REVOKE ALL ON TABLE "_briven_meta" FROM "${role}"`);
  } finally {
    await projPool.end();
  }
}

/**
 * Rotate the project role's password to a fresh random value and return the
 * plaintext + expiry. The caller constructs a DSN from these and never writes
 * them to logs. Uses the `pg` admin connection (ALTER ROLE is cluster-global).
 */
export async function rotateProjectRolePassword(
  projectId: string,
  ttlSeconds: number,
): Promise<{ role: string; password: string; expiresAt: Date }> {
  await provisionProjectRole(projectId);
  const role = roleNameFor(projectId);
  const password = randomPassword(32);
  // `expiresAt` is app-side bookkeeping returned to the caller only — see the
  // DoltGres note below; it is NOT a DB-enforced TTL.
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const admin = client();
  // why: pg cannot parameterize an ALTER ROLE password, so we inline the
  // generated password. randomPassword(32) is hex ([0-9a-f] only), so it can't
  // break out of the SQL string literal; the role name is generated by us too.
  //
  // DoltGres limitation: `ALTER ROLE ... PASSWORD '...' VALID UNTIL '<ts>'`
  // FAILS on DoltGres ("could not parse until"), so we drop the VALID UNTIL
  // clause — SQL-side password expiry is NOT enforced. Security instead relies
  // on rotate-on-issue: every shell-token issue replaces the password, which
  // invalidates any previously-handed-out DSN.
  await admin.query(`ALTER ROLE "${role}" WITH PASSWORD '${password}'`);
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
 * Evict ONE project's cached pool — the per-project "database restart".
 * Closes every pooled connection (in-flight queries finish; idle ones drop)
 * and removes the cache entry so the very next query opens a FRESH pool with
 * a fresh auth handshake. This clears the stuck-connection / stale-auth class
 * of incidents without touching any data. Returns false when no pool was
 * cached (nothing to restart — also fine).
 */
export async function evictProjectPool(projectId: string): Promise<boolean> {
  const dbName = dbNameFor(projectId);
  const pool = _projPools.get(dbName);
  if (!pool) return false;
  _projPools.delete(dbName);
  try {
    await pool.end();
  } catch (err) {
    // The pool is already out of the cache — a noisy close must not fail the
    // restart; the old pool is unreachable either way.
    log.warn('project_db_pool_close_failed', {
      projectId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  log.info('project_db_pool_evicted', { projectId, dbName });
  return true;
}

export interface ProjectDbHealth {
  reachable: boolean;
  latencyMs: number | null;
  tableCount: number | null;
  /** Dolt HEAD commit hash — proves the versioning engine answers too. */
  headCommit: string | null;
  error: string | null;
}

/**
 * Cheap per-project database health probe: fresh query through the normal
 * pool path — counts user tables and reads the Dolt HEAD hash. Fail-soft:
 * never throws, reports the failure in `error` instead.
 */
export async function checkProjectDbHealth(projectId: string): Promise<ProjectDbHealth> {
  const started = Date.now();
  try {
    const rows = await runInProjectDatabase(projectId, (tx) =>
      tx.unsafe(
        `SELECT
           (SELECT count(*)::int
              FROM information_schema.tables
             WHERE table_schema = 'public'
               AND table_type = 'BASE TABLE'
               AND left(table_name, 8) <> '_briven_') AS table_count,
           DOLT_HASHOF('HEAD') AS head`,
      ),
    );
    const row = (rows as Array<{ table_count: number; head: unknown }>)[0];
    // DOLT_HASHOF comes back brace-wrapped on some DoltGres builds — strip.
    const head = row ? String(row.head).replace(/[{}]/g, '') : null;
    return {
      reachable: true,
      latencyMs: Date.now() - started,
      tableCount: row ? Number(row.table_count) : null,
      headCommit: head,
      error: null,
    };
  } catch (err) {
    return {
      reachable: false,
      latencyMs: Date.now() - started,
      tableCount: null,
      headCommit: null,
      error: err instanceof Error ? err.message : String(err),
    };
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

/**
 * DEEP vault liveness — a REAL-login probe, not a warm-pool `SELECT 1`.
 *
 * Why this exists: `pingDataPlane` reuses the long-lived admin pool, whose
 * connection authenticated ONCE at pool-creation. If the vault's auth state
 * later breaks (stale-password / auth.db corruption — the exact 2026-07-02
 * outage), that warm connection keeps answering `SELECT 1` while database
 * creation is dead. This probe opens a FRESH connection every call (so the
 * auth handshake is re-tested now) and runs the SAME `pg_database` catalog
 * read that gates every `CREATE DATABASE` in provisionProjectDatabase — so a
 * green result genuinely means "provisioning could run", not just "a socket
 * is open". DoltGres-proven query (see provisionProjectDatabase:91).
 *
 * Timeouts are client-side (node-postgres), so they don't depend on DoltGres
 * honouring a server-side statement_timeout. Never throws — collapses any
 * failure to false. The 3-strike seatbelt that decides /ready lives in
 * platform-health.ts so a single blip can never pull the live site.
 */
export async function deepPingDataPlane(): Promise<boolean> {
  if (!env.BRIVEN_DATA_PLANE_URL) return false;
  const probe = new pg.Client({
    connectionString: env.BRIVEN_DATA_PLANE_URL,
    connectionTimeoutMillis: 3000,
    query_timeout: 3000,
  });
  try {
    await probe.connect();
    await probe.query('SELECT 1 FROM pg_database LIMIT 1');
    return true;
  } catch (err) {
    log.warn('data_plane_deep_ping_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  } finally {
    // Close the throwaway connection; ignore teardown errors so a failed
    // end() can't mask the probe verdict.
    await probe.end().catch(() => {});
  }
}

export async function closeDataPlane(): Promise<void> {
  await closeProjectDbPools();
  if (_client) {
    await _client.end();
    _client = null;
  }
}
