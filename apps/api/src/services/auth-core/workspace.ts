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
 */
export async function isBrivenEngineAuthEnabled(
  projectId: string,
): Promise<boolean> {
  if (!isAuthCoreInitialized()) return false;
  try {
    const map = mapProjectToAuthCore(projectId);
    const pool = getEnginePool();
    const res = await pool.query(
      `SELECT 1 FROM be_tenants WHERE tenant_id = $1 OR project_id = $2 LIMIT 1`,
      [map.tenantId, map.projectId],
    );
    return Boolean(res.rowCount && res.rowCount > 0);
  } catch {
    return false;
  }
}

/**
 * All projects the user can see + Auth on/off from briven-engine.
 */
export async function listBrivenEngineWorkspace(
  userId: string,
): Promise<{ engine: 'briven-engine'; projects: BrivenEngineWorkspaceProject[] }> {
  const projects = await listProjectsForUser(userId);

  // Batch tenant lookup when engine is ready (no ANY — Doltgres-friendly)
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
        const placeholders = maps.map((_, i) => `$${i + 1}`).join(', ');
        const tenantIds = maps.map((m) => m.tenantId);
        const res = await pool.query(
          `SELECT project_id, tenant_id FROM be_tenants WHERE tenant_id IN (${placeholders}) OR project_id IN (${placeholders})`,
          [...tenantIds, ...maps.map((m) => m.projectId)],
        );
        const tenantToProject = new Map(
          maps.map((m) => [m.tenantId, m.projectId]),
        );
        for (const row of res.rows as Array<{
          project_id: string;
          tenant_id: string;
        }>) {
          enabledProjectIds.add(row.project_id);
          const viaTenant = tenantToProject.get(row.tenant_id);
          if (viaTenant) enabledProjectIds.add(viaTenant);
        }
      }
    } catch {
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
      const authEnabled = enabledProjectIds.has(p.id);
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
