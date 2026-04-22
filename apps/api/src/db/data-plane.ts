import postgres from 'postgres';

import { env } from '../env.js';
import { log } from '../lib/logger.js';

/**
 * Lazily-opened pool for the shared data-plane cluster
 * (`BRIVEN_DATA_PLANE_URL`). Every customer project gets a dedicated
 * Postgres SCHEMA inside this database.
 *
 * Phase 1 has a single shared cluster; Team-tier projects graduate to a
 * dedicated cluster per CLAUDE.md §3.4 — when that lands this file becomes
 * a per-project router instead of a singleton.
 */
let _client: postgres.Sql | null = null;

function client(): postgres.Sql {
  if (!env.BRIVEN_DATA_PLANE_URL) {
    throw new Error('BRIVEN_DATA_PLANE_URL is not configured');
  }
  if (!_client) {
    _client = postgres(env.BRIVEN_DATA_PLANE_URL, {
      max: 20,
      idle_timeout: 30,
      connect_timeout: 5,
      prepare: false,
    });
    log.info('data_plane_connected', { max: 20 });
  }
  return _client;
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
 * Postgres role that owns day-to-day CRUD on a project's schema. Granted at
 * provision time; password is rotated on every `briven db shell` request.
 */
export function roleNameFor(projectId: string): string {
  return `${schemaNameFor(projectId)}_owner`;
}

/**
 * Provision a schema for a new project. Idempotent — safe to call on retry.
 * Also creates the project's scoped login role (see roleNameFor).
 */
export async function provisionProjectSchema(projectId: string): Promise<string> {
  const schema = schemaNameFor(projectId);
  const role = roleNameFor(projectId);
  const sql = client();
  // Identifier interpolation via sql() wrapper validates and quotes safely.
  await sql`CREATE SCHEMA IF NOT EXISTS ${sql(schema)}`;
  // Bookkeeping table the platform owns inside every project schema. Per
  // CLAUDE.md §8.2 the `_briven_` prefix is reserved so customers can't
  // shadow it.
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "${schema}"."_briven_migrations" (
      id text PRIMARY KEY,
      deployment_id text,
      applied_at timestamptz NOT NULL DEFAULT now(),
      summary jsonb
    )
  `);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "${schema}"."_briven_meta" (
      key text PRIMARY KEY,
      value jsonb NOT NULL
    )
  `);
  await provisionProjectRole(projectId);
  log.info('project_schema_provisioned', { projectId, schema, role });
  return schema;
}

/**
 * Create the project's scoped login role and grant CRUD inside its schema.
 * Called at project creation and lazily at shell-token issue time for
 * projects that pre-date this feature.
 */
export async function provisionProjectRole(projectId: string): Promise<void> {
  const schema = schemaNameFor(projectId);
  const role = roleNameFor(projectId);
  const sql = client();
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
  await sql.unsafe(
    `REVOKE ALL ON TABLE "${schema}"."_briven_migrations" FROM "${role}"`,
  );
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
  const sql = client();
  // Identifier quoting via pg_ident escape: we generated `role` ourselves,
  // so it's safe; password is bound via postgres.js parameter binding.
  await sql.unsafe(
    `ALTER ROLE "${role}" WITH PASSWORD $1 VALID UNTIL $2`,
    [password, expiresAt.toISOString()],
  );
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
 * Drop a project schema (used when soft-delete is finalised). Phase 1 we
 * don't call this yet — soft-delete is reversible for 30 days per
 * CLAUDE.md §5.5; the actual DROP runs in a Phase 2 GC job.
 */
export async function dropProjectSchema(projectId: string): Promise<void> {
  const schema = schemaNameFor(projectId);
  const sql = client();
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  log.warn('project_schema_dropped', { projectId, schema });
}

/**
 * Run an arbitrary SQL string inside the project's schema. Wraps the query
 * in `SET LOCAL search_path` so identifiers without a qualifier resolve to
 * the project's tables. Used by the schema-apply worker.
 */
export async function runInProjectSchema<T>(
  projectId: string,
  fn: (sql: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const schema = schemaNameFor(projectId);
  const sql = client();
  return sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL search_path TO "${schema}"`);
    return fn(tx);
  }) as Promise<T>;
}

export function dataPlaneClient(): postgres.Sql {
  return client();
}

export async function pingDataPlane(): Promise<boolean> {
  if (!env.BRIVEN_DATA_PLANE_URL) return false;
  try {
    const sql = client();
    await sql`SELECT 1`;
    return true;
  } catch (err) {
    log.warn('data_plane_ping_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function closeDataPlane(): Promise<void> {
  if (_client) {
    await _client.end({ timeout: 5 });
    _client = null;
  }
}
