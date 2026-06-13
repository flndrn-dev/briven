import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '../env.js';
import { log } from '../lib/logger.js';

import * as schema from './schema.js';

/**
 * Postgres connection pool for the control-plane meta-DB.
 *
 * Lazy-initialised: the API boots without a DB connection if one isn't
 * configured yet (Phase 0 dev), and `/ready` reports `not_configured`
 * until BRIVEN_DATABASE_URL is set. Real dependency probes arrive with
 * Phase 1 once the KVM4 Postgres is up.
 */
let _client: postgres.Sql | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!env.BRIVEN_DATABASE_URL) {
    throw new Error('BRIVEN_DATABASE_URL is not configured');
  }
  if (!_db) {
    _client = postgres(env.BRIVEN_DATABASE_URL, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 5,
      prepare: false,
    });
    _db = drizzle(_client, { schema });
    log.info('db_connected', { max: 10 });
  }
  return _db;
}

export function getSqlClient(): postgres.Sql {
  if (!_client) {
    getDb();
  }
  return _client as postgres.Sql;
}

export async function pingDb(): Promise<boolean> {
  if (!env.BRIVEN_DATABASE_URL) return false;
  try {
    const client = getSqlClient();
    await client`SELECT 1`;
    return true;
  } catch (err) {
    log.warn('db_ping_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function closeDb(): Promise<void> {
  if (_client) {
    await _client.end({ timeout: 5 });
    _client = null;
    _db = null;
  }
}

export { schema };
