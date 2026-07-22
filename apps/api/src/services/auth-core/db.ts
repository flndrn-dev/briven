/**
 * Doltgres connection pool for database `briven_engine`.
 * HARD RULE: only Doltgres. Refuses stock postgres host.
 */

import pg from 'pg';

import { env } from '../../env.js';
import { log } from '../../lib/logger.js';

let pool: pg.Pool | null = null;

function engineDatabaseUrl(): string {
  // Prefer dedicated URL; else rewrite control URL database name to briven_engine.
  if (env.BRIVEN_ENGINE_DATABASE_URL) {
    return env.BRIVEN_ENGINE_DATABASE_URL;
  }
  const base = env.BRIVEN_DATABASE_URL ?? env.BRIVEN_DATA_PLANE_URL;
  if (!base) {
    throw new Error(
      'BRIVEN_ENGINE_DATABASE_URL or BRIVEN_DATABASE_URL required for briven-engine (Doltgres)',
    );
  }
  const u = new URL(base);
  if (u.hostname === 'postgres') {
    throw new Error(
      'DOLTGRES-FIRST: briven-engine refuses stock postgres host — use doltgres',
    );
  }
  u.pathname = '/briven_engine';
  return u.toString();
}

export function openEnginePool(): pg.Pool {
  if (pool) return pool;
  const connectionString = engineDatabaseUrl();
  const host = new URL(connectionString).hostname;
  if (host === 'postgres') {
    throw new Error('DOLTGRES-FIRST: refusing stock postgres for briven-engine');
  }
  pool = new pg.Pool({
    connectionString,
    max: 10,
    // Doltgres-friendly
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', (err) => {
    log.warn('briven_engine_pool_error', {
      message: err instanceof Error ? err.message : String(err),
    });
  });
  log.info('briven_engine_pool_open', { host, database: 'briven_engine' });
  return pool;
}

export function getEnginePool(): pg.Pool {
  if (!pool) return openEnginePool();
  return pool;
}

export function isEnginePoolReady(): boolean {
  return pool != null;
}

export async function closeEnginePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
