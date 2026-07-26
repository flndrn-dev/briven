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
 * Idempotent. Re-enables if previously soft-disabled.
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
  if (result.ok) {
    try {
      const pool = getEnginePool();
      // Clear soft-disable so Auth is on again (users/data stay intact).
      await pool.query(
        `UPDATE be_tenants SET disabled_at = NULL
         WHERE tenant_id = $1 OR project_id = $2`,
        [result.tenantId, result.projectId],
      );
    } catch {
      /* column may not exist yet on very old engines — treat as enabled */
    }
  }
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
 * Turn Auth off for a project without deleting end-users or credentials.
 * Soft-disable: tenant stays, disabled_at is set; app login should treat Auth as off.
 */
export async function disableBrivenEngineAuth(projectId: string): Promise<{
  ok: boolean;
  engine: 'briven-engine';
  projectId: string;
  tenantId: string;
  authEnabled: boolean;
  message?: string;
  storage: 'doltgres';
}> {
  const map = mapProjectToAuthCore(projectId);
  const base = {
    engine: 'briven-engine' as const,
    storage: 'doltgres' as const,
    projectId: map.projectId,
    tenantId: map.tenantId,
  };
  if (!isAuthCoreInitialized()) {
    return {
      ...base,
      ok: false,
      authEnabled: false,
      message: 'briven-engine not ready on Doltgres',
    };
  }
  try {
    const pool = getEnginePool();
    // Ensure soft-disable column exists (older engines may not have run migration).
    try {
      await pool.query(`ALTER TABLE be_tenants ADD COLUMN disabled_at TIMESTAMPTZ`);
    } catch {
      /* already exists or unsupported — continue */
    }
    const existing = await pool.query(
      `SELECT tenant_id FROM be_tenants
       WHERE tenant_id = $1 OR project_id = $2
       LIMIT 1`,
      [map.tenantId, map.projectId],
    );
    if (!existing.rowCount) {
      return {
        ...base,
        ok: true,
        authEnabled: false,
        message: 'Auth was already off for this project',
      };
    }
    try {
      await pool.query(
        `UPDATE be_tenants SET disabled_at = NOW()
         WHERE tenant_id = $1 OR project_id = $2`,
        [map.tenantId, map.projectId],
      );
    } catch (err) {
      // Fallback if disabled_at column missing: leave row (still "on") and report.
      const message = err instanceof Error ? err.message : String(err);
      return {
        ...base,
        ok: false,
        authEnabled: true,
        message: `could not disable Auth: ${message}`,
      };
    }
    return {
      ...base,
      ok: true,
      authEnabled: false,
      message:
        'Auth disabled for this project. User data is kept — enable Auth again anytime.',
    };
  } catch (err) {
    return {
      ...base,
      ok: false,
      authEnabled: true,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Whether Auth is on for a project (tenant row exists and not soft-disabled).
 */
export async function isBrivenEngineAuthEnabled(
  projectId: string,
): Promise<boolean> {
  if (!isAuthCoreInitialized()) return false;
  try {
    const map = mapProjectToAuthCore(projectId);
    const pool = getEnginePool();
    // Prefer disabled_at IS NULL; if column missing, any tenant row means on.
    try {
      const res = await pool.query(
        `SELECT 1 FROM be_tenants
         WHERE (tenant_id = $1 OR project_id = $2)
           AND disabled_at IS NULL
         LIMIT 1`,
        [map.tenantId, map.projectId],
      );
      return Boolean(res.rowCount && res.rowCount > 0);
    } catch {
      const res = await pool.query(
        `SELECT 1 FROM be_tenants
         WHERE tenant_id = $1 OR project_id = $2
         LIMIT 1`,
        [map.tenantId, map.projectId],
      );
      return Boolean(res.rowCount && res.rowCount > 0);
    }
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

  // Build maps first — Auth on = be_tenants row for that project's tenant_id.
  const maps = projects
    .map((p) => {
      try {
        return mapProjectToAuthCore(p.id);
      } catch {
        return null;
      }
    })
    .filter((m): m is NonNullable<typeof m> => m != null);

  const tenantToProject = new Map(maps.map((m) => [m.tenantId, m.projectId]));
  let enabledProjectIds = new Set<string>();

  if (isAuthCoreInitialized() && maps.length > 0) {
    try {
      const pool = getEnginePool();
      // Active Auth only: tenant row and not soft-disabled.
      let res;
      try {
        res = await pool.query(
          `SELECT project_id, tenant_id FROM be_tenants
           WHERE disabled_at IS NULL`,
        );
      } catch {
        res = await pool.query(`SELECT project_id, tenant_id FROM be_tenants`);
      }
      for (const row of res.rows as Array<{
        project_id: string;
        tenant_id: string;
      }>) {
        markEnabled(enabledProjectIds, row.project_id);
        const viaTenant = tenantToProject.get(row.tenant_id);
        markEnabled(enabledProjectIds, viaTenant);
        // Also match tenant_id → project when project_id column is stale/mismatched
        if (row.tenant_id.startsWith('proj-')) {
          const fromTenant = tenantToProject.get(row.tenant_id);
          markEnabled(enabledProjectIds, fromTenant);
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

      let authEnabled =
        enabledProjectIds.has(p.id) ||
        enabledProjectIds.has(p.id.toLowerCase());

      // Direct probe when batch missed (should be rare).
      if (!authEnabled && isAuthCoreInitialized()) {
        authEnabled = await isBrivenEngineAuthEnabled(p.id);
      }

      if (!authEnabled) {
        return {
          id: p.id,
          slug: p.slug,
          name,
          authEnabled: false,
          // Do not show mapped tenant as if Auth were on
          tenantId: null,
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
