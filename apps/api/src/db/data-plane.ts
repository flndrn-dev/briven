import mysql from 'mysql2/promise';

import { env } from '../env.js';
import { log } from '../lib/logger.js';

/**
 * Lazily-opened pool for the shared data-plane Dolt server
 * (`BRIVEN_DOLT_URL`). Every customer project gets a dedicated
 * **database** (not schema) — `proj_<projectId>`.
 *
 * Phase 1 has a single shared Dolt server; Team-tier projects may graduate
 * to a dedicated server per CLAUDE.md §3.4 — when that lands this file
 * becomes a per-project router instead of a singleton.
 *
 * @README-DOLT ADR 0001 — migrated from postgres (schema-per-project)
 *   to mysql2 (database-per-project).
 *
 *   - `postgres(url, opts)` → `mysql.createPool({ uri: url, ...opts })`
 *   - `CREATE SCHEMA` → `CREATE DATABASE`
 *   - `SET LOCAL search_path TO "schema"` → `USE database` (per-connection)
 *   - `pg_roles` → MySQL users (`CREATE USER`, `GRANT ALL ON db.*`)
 *   - `ALTER ROLE ... PASSWORD` → `ALTER USER ... IDENTIFIED BY`
 *   - Parameter placeholders: `$1` → `?`
 *   - Identifier quoting: `"..."` → `` `...` ``
 *   - `sql.begin()` → `connection.beginTransaction()`
 */
let _pool: mysql.Pool | null = null;

function pool(): mysql.Pool {
  if (!env.BRIVEN_DOLT_URL) {
    throw new Error('BRIVEN_DOLT_URL is not configured');
  }
  if (!_pool) {
    _pool = mysql.createPool({
      uri: env.BRIVEN_DOLT_URL,
      connectionLimit: 20,
      idleTimeout: 30000,
      connectTimeout: 5000,
    });
    log.info('data_plane_connected', { max: 20 });
  }
  return _pool;
}

/**
 * Map a `projectId` (e.g. `p_01HZ...`) to the Dolt database name we
 * provision for it. We strip the prefix (which contains characters
 * unfriendly to identifiers) and prefix `proj_` so the bare project id
 * remains visible to operators.
 *
 * MySQL database names max 64 chars; our prefix + sanitised ULID is
 * well under that.
 */
export function dbNameFor(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return `proj_${safe}`;
}

/**
 * @deprecated Use `dbNameFor` instead. Kept for backward compatibility
 * during the migration — callers that used `schemaNameFor` will be
 * migrated in follow-up commits.
 */
export const schemaNameFor = dbNameFor;

/**
 * MySQL user that owns day-to-day CRUD on a project's database. Created at
 * provision time; password is rotated on every `briven db shell` request.
 *
 * MySQL user names max 32 chars by default; Dolt inherits this. Our
 * `proj_<sanitised>_owner` pattern fits within 32 chars because the
 * sanitised ULID is ~26 chars + 5 prefix + 6 suffix = 37 — too long.
 * We truncate to `proj_<sanitised>` (max ~31) for the user name, then
 * append `_o` to signal "owner" when there's room, otherwise use the
 * base name.
 */
export function roleNameFor(projectId: string): string {
  const db = dbNameFor(projectId);
  // 'proj_' (5) + sanitised (max ~30) + '_owner' (6) = 41 > 32.
  // Truncate: use just the database name, max 32 chars.
  if (db.length <= 29) return `${db}_o`;
  return db.substring(0, 32);
}

/**
 * Provision a database for a new project. Idempotent — safe to call on
 * retry. Also creates the project's scoped MySQL user (see roleNameFor).
 */
export async function provisionProjectSchema(projectId: string): Promise<string> {
  const db = dbNameFor(projectId);
  const role = roleNameFor(projectId);
  const conn = await pool().getConnection();
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${db}\``);

    // Bookkeeping tables the platform owns inside every project database.
    // Per CLAUDE.md §8.2 the `_briven_` prefix is reserved so customers
    // can't shadow it.
    await conn.query(`USE \`${db}\``);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`_briven_migrations\` (
        id VARCHAR(36) PRIMARY KEY,
        deployment_id VARCHAR(36),
        applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        summary JSON
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`_briven_meta\` (
        \`key\` VARCHAR(128) PRIMARY KEY,
        value JSON NOT NULL
      )
    `);
    await provisionProjectRole(projectId);
    log.info('project_db_provisioned', { projectId, db, role });
  } finally {
    conn.release();
  }
  return db;
}

/**
 * Create the project's scoped MySQL user and grant CRUD inside its
 * database. Called at project creation and lazily at shell-token issue
 * time for projects that pre-date this feature.
 *
 * MySQL `CREATE USER IF NOT EXISTS` is supported since 5.7 / MariaDB 10.1;
 * Dolt is compatible.
 */
export async function provisionProjectRole(projectId: string): Promise<void> {
  const db = dbNameFor(projectId);
  const role = roleNameFor(projectId);
  const conn = await pool().getConnection();
  try {
    // CREATE USER IF NOT EXISTS — idempotent.
    // Password is set to a random value initially; rotated on first shell access.
    await conn.query(
      `CREATE USER IF NOT EXISTS ?@'%' IDENTIFIED BY ?`,
      [role, randomPassword(32)],
    );
    await conn.query(`GRANT ALL ON \`${db}\`.* TO ?@'%'`, [role]);
    // Revoke write access to platform tables from the user.
    await conn.query(`REVOKE ALL ON \`${db}\`.\`_briven_migrations\` FROM ?@'%'`, [role]);
    await conn.query(`REVOKE ALL ON \`${db}\`.\`_briven_meta\` FROM ?@'%'`, [role]);
    await conn.query(`FLUSH PRIVILEGES`);
  } finally {
    conn.release();
  }
}

/**
 * Rotate the project user's password to a short-lived random value and
 * return the plaintext + expiry. The caller constructs a DSN from these
 * and never writes them to logs.
 */
export async function rotateProjectRolePassword(
  projectId: string,
  ttlSeconds: number,
): Promise<{ role: string; password: string; expiresAt: Date }> {
  await provisionProjectRole(projectId);
  const role = roleNameFor(projectId);
  const password = randomPassword(32);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const conn = await pool().getConnection();
  try {
    // MySQL: ALTER USER to rotate password. Expiry is set via
    // PASSWORD EXPIRE INTERVAL — we set it to the TTL in days
    // (rounded up to the nearest day, minimum 1).
    const expireDays = Math.max(1, Math.ceil(ttlSeconds / 86400));
    await conn.query(
      `ALTER USER ?@'%' IDENTIFIED BY ? PASSWORD EXPIRE INTERVAL ? DAY`,
      [role, password, expireDays],
    );
    await conn.query(`FLUSH PRIVILEGES`);
  } finally {
    conn.release();
  }
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
 * Drop a project database (used when soft-delete is finalised). Phase 1
 * we don't call this yet — soft-delete is reversible for 30 days per
 * CLAUDE.md §5.5; the actual DROP runs in a Phase 2 GC job.
 */
export async function dropProjectSchema(projectId: string): Promise<void> {
  const db = dbNameFor(projectId);
  const conn = await pool().getConnection();
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
    log.warn('project_db_dropped', { projectId, db });
  } finally {
    conn.release();
  }
}

/**
 * Run an arbitrary SQL function inside the project's database. Gets a
 * dedicated connection, switches to the project database via `USE`, and
 * runs the function within a transaction.
 *
 * @README-DOLT MySQL `USE` is connection-scoped, not transaction-scoped.
 * We get a dedicated connection per call to avoid polluting the pool's
 * default database. The connection is released back to the pool after
 * the function completes (or throws).
 */
export async function runInProjectSchema<T>(
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

export function dataPlaneClient(): mysql.Pool {
  return pool();
}

export async function pingDataPlane(): Promise<boolean> {
  if (!env.BRIVEN_DOLT_URL) return false;
  try {
    const conn = await pool().getConnection();
    await conn.ping();
    conn.release();
    return true;
  } catch (err) {
    log.warn('data_plane_ping_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function closeDataPlane(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
