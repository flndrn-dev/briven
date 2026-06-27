import { dbNameFor, rotateProjectRolePassword } from '../db/data-plane.js';
import { env } from '../env.js';

/**
 * Issue a short-lived DSN the user can pass to `psql`. The role's password is
 * rotated on every call, so a leaked DSN is invalidated by the next issue —
 * security relies on rotate-on-issue, not a SQL-side TTL (DoltGres rejects
 * `VALID UNTIL`; `expiresAt` is app-side bookkeeping). No manual revocation
 * required.
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
  const dbName = dbNameFor(projectId);

  const base = new URL(env.BRIVEN_DATA_PLANE_URL);
  base.username = role;
  base.password = password;
  // why: database-per-project — point the DSN at the project's own DoltGres
  // database so the user lands directly on their tables (in its `public`
  // schema). No `search_path` option needed; platform tables are blocked by
  // REVOKE at the grant layer.
  base.pathname = `/${dbName}`;

  return { dsn: base.toString(), role, expiresAt };
}
