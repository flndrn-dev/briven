import { dbNameFor, rotateProjectRolePassword } from '../db/data-plane.js';
import { env } from '../env.js';

/**
 * Issue a short-lived DSN the user can pass to `mysql`. The role's password
 * is rotated on every call, so leaked DSNs expire with the MySQL-side
 * PASSWORD EXPIRE clause — no manual revocation required.
 *
 * @README-DOLT ADR 0001 — migrated from Postgres `psql` DSN to MySQL DSN.
 *   - `BRIVEN_DATA_PLANE_URL` → `BRIVEN_URL`
 *   - `schemaNameFor` → `dbNameFor`
 *   - `-csearch_path=<schema>` → `database` query param (MySQL)
 */
export async function issueShellToken(projectId: string): Promise<{
  dsn: string;
  role: string;
  expiresAt: Date;
}> {
  if (!env.BRIVEN_URL) {
    throw new Error('BRIVEN_URL is not configured');
  }
  const { role, password, expiresAt } = await rotateProjectRolePassword(projectId, 15 * 60);
  const db = dbNameFor(projectId);

  const base = new URL(env.BRIVEN_URL);
  base.username = role;
  base.password = password;
  // MySQL clients use `database` query param to select the default
  // database on connect — equivalent to Postgres `-csearch_path`.
  // The user lands directly in their project database.
  base.searchParams.set('database', db);

  return { dsn: base.toString(), role, expiresAt };
}
