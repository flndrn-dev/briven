import mysql from 'mysql2/promise';

import { env } from './env.js';

let _pool: mysql.Pool | null = null;

function pool(): mysql.Pool {
  if (!env.BRIVEN_URL) {
    throw new Error('BRIVEN_URL is not configured on the runtime');
  }
  if (!_pool) {
    _pool = mysql.createPool({
      uri: env.BRIVEN_URL,
      connectionLimit: 20,
      idleTimeout: 30000,
      connectTimeout: 5000,
    });
  }
  return _pool;
}

/**
 * Mirror of `apps/api/src/db/data-plane.ts:dbNameFor` — must stay in
 * sync. Both sides derive the database name deterministically from the
 * project id so the api never has to ship the database name in the
 * invoke request payload.
 *
 * @README-BRIVEN Previously `schemaNameFor` — now `dbNameFor` since each
 * project gets a dedicated MySQL database, not a Postgres schema.
 */
export function dbNameFor(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return `proj_${safe}`;
}

export interface DbSession {
  readonly conn: mysql.PoolConnection;
}

/**
 * Open a project-scoped transaction. Gets a dedicated connection, switches
 * to the project's database via `USE`, and begins a transaction. The
 * transaction commits when `fn` resolves; on throw it rolls back
 * automatically.
 *
 * @README-BRIVEN ADR 0001 — migrated from postgres to mysql2.
 *   - `SET LOCAL search_path TO "schema"` → `USE database` (per-connection)
 *   - `sql.begin()` → `conn.beginTransaction()` + `conn.commit()` / `conn.rollback()`
 */
export async function withProjectTx<T>(
  projectId: string,
  fn: (conn: mysql.PoolConnection) => Promise<T>,
): Promise<T> {
  const db = dbNameFor(projectId);
  const conn = await pool().getConnection();
  try {
    await conn.query(`USE \`${db}\``);
    await conn.beginTransaction();
    try {
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  } finally {
    conn.release();
  }
}
