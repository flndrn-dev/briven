import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { env } from '../env.js';
import { log } from '../lib/logger.js';

import * as schema from './schema.js';

/**
 * Control-plane meta-DB pool.
 *
 * Uses `pg` (node-postgres), not `postgres` (postgres.js): Doltgres's wire
 * protocol panics on many postgres.js prepared/extended-query paths
 * (`unhandled message "&{}"`). `pg` is proven against Doltgres for control
 * queries (product line: control + data plane both on Doltgres).
 *
 * Lazy-initialised: `/ready` reports not_configured until BRIVEN_DATABASE_URL
 * is set.
 */
let _pool: pg.Pool | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!env.BRIVEN_DATABASE_URL) {
    throw new Error('BRIVEN_DATABASE_URL is not configured');
  }
  if (!_db) {
    _pool = new pg.Pool({
      connectionString: env.BRIVEN_DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    _db = drizzle(_pool, { schema });
    log.info('db_connected', { max: 10, driver: 'node-postgres' });
  }
  return _db;
}

export function getPool(): pg.Pool {
  if (!_pool) {
    getDb();
  }
  return _pool as pg.Pool;
}

/** @deprecated Prefer getDb() / getPool(). Kept for ping helper. */
export function getSqlClient(): pg.Pool {
  return getPool();
}

export async function pingDb(): Promise<boolean> {
  if (!env.BRIVEN_DATABASE_URL) return false;
  try {
    const pool = getPool();
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
