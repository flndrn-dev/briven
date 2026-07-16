import pg from 'pg';

import { env } from './env.js';

/**
 * One cached `pg` (node-postgres) pool per project, each bound to that
 * project's DoltGres database. DoltGres speaks the Postgres wire protocol
 * but — like Postgres — cannot switch database mid-connection (there is no
 * `USE`), so the database is selected at connect time and the pool is reused
 * across invocations.
 *
 * @README-BRIVEN ADR 0001 — converged onto DoltGres. We use the `pg` driver
 * (node-postgres), NOT postgres.js: hands-on testing proved postgres.js's
 * extended-protocol pipelining desyncs with DoltGres (`unhandled message
 * "&{}"` even on `SELECT 1`), while `pg` works perfectly including the full
 * git-for-data loop. We parse the base data-plane URL once and build each
 * per-project pool from explicit fields with the database overridden to
 * `proj_<id>`.
 */
const _pools = new Map<string, pg.Pool>();
let _base: URL | null = null;

function baseUrl(): URL {
  if (!env.BRIVEN_DATA_PLANE_URL) {
    throw new Error('BRIVEN_DATA_PLANE_URL is not configured on the runtime');
  }
  if (!_base) _base = new URL(env.BRIVEN_DATA_PLANE_URL);
  return _base;
}

function poolFor(projectId: string): pg.Pool {
  const db = dbNameFor(projectId);
  let pool = _pools.get(db);
  if (!pool) {
    const base = baseUrl();
    pool = new pg.Pool({
      host: base.hostname,
      port: Number(base.port || 5432),
      user: decodeURIComponent(base.username),
      password: decodeURIComponent(base.password),
      database: db,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    _pools.set(db, pool);
  }
  return pool;
}

/**
 * Mirror of `apps/api/src/db/data-plane.ts:dbNameFor` — must stay in sync.
 * Both sides derive the database name deterministically from the project id
 * so the api never has to ship the database name in the invoke request
 * payload.
 *
 * Each project gets a dedicated DoltGres database named `proj_<sanitized id>`.
 */
export function dbNameFor(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return `proj_${safe}`;
}

/**
 * The adapter handed to `fn` inside `withProjectTx`. Preserves the interface
 * callers (query-builder.ts, runtime-bootstrap.ts) depend on: a single
 * `unsafe(text, params?)` method that returns a `Promise` of the result rows
 * directly (mirrors postgres.js's `tx.unsafe`, which is what this replaced).
 */
export interface ProjectTx {
  unsafe(text: string, params?: readonly unknown[]): Promise<unknown[]>;
}

/**
 * Open a project-scoped transaction against the project's DoltGres database.
 * Reuses the cached per-project pool, checks out one client, and runs `fn`
 * inside a BEGIN/COMMIT; it rolls back automatically on throw.
 *
 * Auto-commit-per-write: the first statement turns on
 * `dolt_transaction_commit`, so the SQL COMMIT that closes this transaction
 * ALSO creates a Dolt commit — advancing the version log that powers Undo and
 * realtime change-detection. (Verified against a real DoltGres: a plain INSERT
 * does NOT advance `DOLT_HASHOF('HEAD')` unless this is set or DOLT_COMMIT is
 * called explicitly.)
 *
 * @README-BRIVEN ADR 0001 — uses `pg` (node-postgres), not postgres.js:
 *   - `sql.begin(fn)` → explicit `client.connect()` + BEGIN / COMMIT / ROLLBACK
 *   - first-statement `SET dolt_transaction_commit = 1` makes COMMIT a Dolt commit
 *   - `fn` receives a `{ unsafe }` adapter so callers are unchanged
 */
export async function withProjectTx<T>(
  projectId: string,
  fn: (tx: ProjectTx) => Promise<T>,
): Promise<T> {
  const pool = poolFor(projectId);
  const client = await pool.connect();
  const tx: ProjectTx = {
    unsafe: (text, params) =>
      client.query(text, params ? [...params] : undefined).then((r) => r.rows),
  };
  try {
    await client.query('BEGIN');
    await client.query('SET dolt_transaction_commit = 1');
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // A failed rollback must not mask the original error.
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * End every cached project pool. Test/shutdown hook — after this the next
 * `withProjectTx` lazily rebuilds the pool it needs.
 */
export async function closeAllProjectClients(): Promise<void> {
  await Promise.all([..._pools.values()].map((p) => p.end()));
  _pools.clear();
}
