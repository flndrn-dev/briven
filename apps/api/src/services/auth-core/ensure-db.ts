/**
 * Ensure Doltgres database `briven_engine` exists (DOLTGRES-FIRST).
 *
 * Stock Postgres is forbidden for product Auth state. SuperTokens Core
 * connects with a postgresql:// URI *to doltgres* (wire protocol only).
 *
 * NOTE: Creating the DB is not enough for a healthy Core today — Core still
 * crashes on Doltgres with `SET SESSION CHARACTERISTICS is not yet supported`.
 * See BRIVEN-ENGINE-DOLTGRES-GOTCHA.md. We still ensure the DB on Doltgres
 * so we never drift back to stock Postgres.
 *
 * Safe to call at API boot; no-ops when already present or data-plane URL unset.
 */

import pg from 'pg';

import { env } from '../../env.js';
import { log } from '../../lib/logger.js';

const ENGINE_DB = 'briven_engine';

/**
 * Create `briven_engine` on the Doltgres cluster if missing.
 * Uses BRIVEN_DATA_PLANE_URL (admin) or BRIVEN_DATABASE_URL host.
 */
export async function ensureBrivenEngineDatabase(): Promise<{
  ok: boolean;
  engine: 'briven-engine';
  db: typeof ENGINE_DB;
  host: 'doltgres' | 'unknown';
  created: boolean;
  message?: string;
}> {
  const base = {
    engine: 'briven-engine' as const,
    db: ENGINE_DB,
    host: 'doltgres' as const,
  };

  // Prefer data-plane admin URL (points at doltgres). Never invent stock postgres.
  // BRIVEN_ENGINE_DATABASE_URL points at briven_engine — use its host for admin.
  let adminUrl =
    env.BRIVEN_DATA_PLANE_URL ??
    env.BRIVEN_DATABASE_URL ??
    null;
  if (!adminUrl && env.BRIVEN_ENGINE_DATABASE_URL) {
    try {
      const u = new URL(env.BRIVEN_ENGINE_DATABASE_URL);
      u.pathname = '/postgres';
      adminUrl = u.toString();
    } catch {
      adminUrl = null;
    }
  }

  if (!adminUrl) {
    return {
      ...base,
      ok: false,
      created: false,
      message: 'no BRIVEN_DATA_PLANE_URL / BRIVEN_DATABASE_URL — cannot ensure Doltgres DB',
    };
  }

  // Guard: refuse if URL clearly targets stock service name `postgres` without doltgres
  // (compose product line must use host doltgres).
  try {
    const u = new URL(adminUrl);
    if (u.hostname === 'postgres') {
      log.error('briven_engine_db_refuses_stock_postgres', {
        message: 'DOLTGRES-FIRST: briven_engine must not use stock postgres host',
      });
      return {
        ...base,
        ok: false,
        created: false,
        message: 'refusing stock postgres host — use doltgres',
      };
    }
  } catch {
    /* continue with raw URL */
  }

  const client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
    const found = await client.query(
      `SELECT 1 AS ok FROM pg_database WHERE datname = $1`,
      [ENGINE_DB],
    );
    if (found.rowCount && found.rowCount > 0) {
      log.info('briven_engine_db_exists', { db: ENGINE_DB, host: 'doltgres' });
      return { ...base, ok: true, created: false, message: 'already exists on Doltgres' };
    }

    // Doltgres: CREATE DATABASE outside a transaction; no reliable IF NOT EXISTS.
    await client.query(`CREATE DATABASE "${ENGINE_DB}"`);
    log.info('briven_engine_db_created', { db: ENGINE_DB, host: 'doltgres' });
    return { ...base, ok: true, created: true, message: 'created on Doltgres' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('briven_engine_db_ensure_failed', { message });
    return { ...base, ok: false, created: false, message };
  } finally {
    await client.end().catch(() => undefined);
  }
}
