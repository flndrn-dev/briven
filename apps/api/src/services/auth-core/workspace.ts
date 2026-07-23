/**
 * briven-engine dashboard workspace — projects the operator can manage,
 * with Auth on/off based on be_tenants (Doltgres).
 */

import { listProjectsForUser } from '../projects.js';
import { getEnginePool } from './db.js';
import { isAuthCoreInitialized } from './engine.js';
import { ensureBrivenEngineTenant } from './multitenancy.js';
import { getBrivenEngineProjectConfig } from './project-config.js';
import { mapProjectToAuthCore } from './project-map.js';

export type BrivenEngineWorkspaceProject = {
  id: string;
  slug: string;
  name: string;
  authEnabled: boolean;
  tenantId: string | null;
  providers: {
    emailPassword: boolean;
    magicLink: boolean;
    emailOtp: boolean;
    passkey: boolean;
  } | null;
  error?: boolean;
};

/**
 * Enable Auth for a project = create briven-engine tenant island on Doltgres.
 * Idempotent.
 */
export async function enableBrivenEngineAuth(projectId: string): Promise<{
  ok: boolean;
  engine: 'briven-engine';
  projectId: string;
  tenantId: string;
  authEnabled: boolean;
  created: boolean;
  message?: string;
  storage: 'doltgres';
}> {
  const result = await ensureBrivenEngineTenant(projectId);
  return {
    ok: result.ok,
    engine: 'briven-engine',
    projectId: result.projectId,
    tenantId: result.tenantId,
    authEnabled: result.ok,
    created: result.created,
    message: result.message,
    storage: 'doltgres',
  };
}

/**
 * Whether Auth is on for a project (tenant row exists).
 * Matches tenant_id (mapped) or project_id (exact / case-insensitive).
 */
export async function isBrivenEngineAuthEnabled(
  projectId: string,
): Promise<boolean> {
  if (!isAuthCoreInitialized()) return false;
  try {
    const map = mapProjectToAuthCore(projectId);
    const pool = getEnginePool();
    const res = await pool.query(
      `SELECT 1 FROM be_tenants
       WHERE tenant_id = $1
          OR project_id = $2
          OR lower(project_id) = lower($2)
       LIMIT 1`,
      [map.tenantId, map.projectId],
    );
    return Boolean(res.rowCount && res.rowCount > 0);
  } catch {
    return false;
  }
}

function markEnabled(
  set: Set<string>,
  projectId: string | null | undefined,
): void {
  if (!projectId) return;
  set.add(projectId);
  set.add(projectId.toLowerCase());
}

/**
 * All projects the user can see + Auth on/off from briven-engine.
 */
export async function listBrivenEngineWorkspace(
  userId: string,
): Promise<{ engine: 'briven-engine'; projects: BrivenEngineWorkspaceProject[] }> {
  const projects = await listProjectsForUser(userId);

  // Batch tenant lookup when engine is ready.
  // IMPORTANT: two IN lists need two placeholder ranges ($1..$n and $n+1..$2n).
  let enabledProjectIds = new Set<string>();
  if (isAuthCoreInitialized() && projects.length > 0) {
    try {
      const pool = getEnginePool();
      const maps = projects
        .map((p) => {
          try {
            return mapProjectToAuthCore(p.id);
          } catch {
            return null;
          }
        })
        .filter((m): m is NonNullable<typeof m> => m != null);

      if (maps.length > 0) {
        const n = maps.length;
        const tenantPh = maps.map((_, i) => `$${i + 1}`).join(', ');
        const projectPh = maps.map((_, i) => `$${i + 1 + n}`).join(', ');
        const lowerPh = maps.map((_, i) => `$${i + 1 + 2 * n}`).join(', ');
        const tenantIds = maps.map((m) => m.tenantId);
        const projectIds = maps.map((m) => m.projectId);
        const projectIdsLower = projectIds.map((id) => id.toLowerCase());
        const res = await pool.query(
          `SELECT project_id, tenant_id FROM be_tenants
           WHERE tenant_id IN (${tenantPh})
              OR project_id IN (${projectPh})
              OR lower(project_id) IN (${lowerPh})`,
          [...tenantIds, ...projectIds, ...projectIdsLower],
        );
        const tenantToProject = new Map(
          maps.map((m) => [m.tenantId, m.projectId]),
        );
        for (const row of res.rows as Array<{
          project_id: string;
          tenant_id: string;
        }>) {
          markEnabled(enabledProjectIds, row.project_id);
          const viaTenant = tenantToProject.get(row.tenant_id);
          markEnabled(enabledProjectIds, viaTenant);
        }
      }
    } catch {
      // Fall back to per-project checks below when batch query fails.
      enabledProjectIds = new Set();
    }
  }

  const rows: BrivenEngineWorkspaceProject[] = await Promise.all(
    projects.map(async (p) => {
      const name = (p as { name?: string | null }).name?.trim() || p.slug;
      let tenantId: string | null = null;
      try {
        tenantId = mapProjectToAuthCore(p.id).tenantId;
      } catch {
        tenantId = null;
      }

      let authEnabled =
        enabledProjectIds.has(p.id) ||
        enabledProjectIds.has(p.id.toLowerCase());

      // Reliable fallback: direct tenant probe (also covers batch SQL miss).
      if (!authEnabled && isAuthCoreInitialized()) {
        authEnabled = await isBrivenEngineAuthEnabled(p.id);
      }

      if (!authEnabled) {
        return {
          id: p.id,
          slug: p.slug,
          name,
          authEnabled: false,
          tenantId,
          providers: null,
        };
      }
      try {
        const config = await getBrivenEngineProjectConfig(p.id);
        return {
          id: p.id,
          slug: p.slug,
          name,
          authEnabled: true,
          tenantId: config.tenantId,
          providers: {
            emailPassword: config.recipes.emailPassword,
            magicLink: config.recipes.passwordless,
            emailOtp: config.recipes.passwordless,
            passkey: config.recipes.webauthn,
          },
        };
      } catch {
        return {
          id: p.id,
          slug: p.slug,
          name,
          authEnabled: true,
          tenantId,
          providers: {
            emailPassword: true,
            magicLink: true,
            emailOtp: true,
            passkey: true,
          },
        };
      }
    }),
  );

  return { engine: 'briven-engine', projects: rows };
}
