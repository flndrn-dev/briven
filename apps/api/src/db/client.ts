import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

import { env } from '../env.js';
import { log } from '../lib/logger.js';

import * as schema from './schema.js';

/**
 * MySQL connection pool for the control-plane meta-DB.
 *
 * Lazy-initialised: the API boots without a DB connection if one isn't
 * configured yet (Phase 0 dev), and `/ready` reports `not_configured`
 * until BRIVEN_DOLT_URL is set.
 *
 * @README-DOLT ADR 0001 — migrated from postgres-js to mysql2.
 *   - `postgres(url, opts)` → `mysql.createPool(url)`
 *   - `postgres.Sql` → `mysql.Pool`
 *   - `client.end()` → `pool.end()`
 *   - `client\`SELECT 1\`` → `pool.query('SELECT 1')`
 */
let _pool: mysql.Pool | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!env.BRIVEN_DOLT_URL) {
    throw new Error('BRIVEN_DOLT_URL is not configured');
  }
  if (!_db) {
    _pool = mysql.createPool({
      uri: env.BRIVEN_DOLT_URL,
      connectionLimit: 10,
      idleTimeout: 30000,
      connectTimeout: 5000,
    });
    _db = drizzle(_pool, { schema });
    log.info('db_connected', { max: 10 });
  }
  return _db;
}

export function getSqlClient(): mysql.Pool {
  if (!_pool) {
    getDb();
  }
  return _pool as mysql.Pool;
}

export async function pingDb(): Promise<boolean> {
  if (!env.BRIVEN_DOLT_URL) return false;
  try {
    const pool = getSqlClient();
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    log.warn('db_ping_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
}

export { schema };
