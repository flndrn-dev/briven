import { rotateProjectRolePassword, schemaNameFor } from '../db/data-plane.js';
import { env } from '../env.js';

/**
 * Issue a short-lived DSN the user can pass to `psql`. The role's password
 * is rotated on every call, so leaked DSNs expire with the SQL-side
 * VALID UNTIL clause — no manual revocation required.
 */
export async function issueShellToken(projectId: string): Promise<{
  dsn: string;
  role: string;
  expiresAt: Date;
}> {
  if (!env.BRIVEN_DATA_PLANE_URL) {
    throw new Error('BRIVEN_DATA_PLANE_URL is not configured');
  }
  const { role, password, expiresAt } = await rotateProjectRolePassword(projectId, 15 * 60);
  const schema = schemaNameFor(projectId);

  const base = new URL(env.BRIVEN_DATA_PLANE_URL);
  base.username = role;
  base.password = password;
  // why: `-csearch_path=<schema>` drops the user straight into their own
  // tables without having to remember `SET search_path`. Platform tables
  // are blocked by REVOKE at the grant layer, not by this path.
  base.searchParams.set('options', `-csearch_path=${schema}`);

  return { dsn: base.toString(), role, expiresAt };
}
