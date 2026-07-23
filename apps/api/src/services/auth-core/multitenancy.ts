/**
 * Multitenancy on Doltgres — project → tenant rows in be_tenants.
 */

import { getEnginePool } from './db.js';
import { isAuthCoreInitialized } from './engine.js';
import { mapProjectToAuthCore } from './project-map.js';
import { log } from '../../lib/logger.js';

export type EnsureTenantResult = {
  engine: 'briven-engine';
  projectId: string;
  appId: string;
  tenantId: string;
  created: boolean;
  ok: boolean;
  message?: string;
  storage: 'doltgres';
};

export async function ensureBrivenEngineTenant(
  projectId: string,
): Promise<EnsureTenantResult> {
  const map = mapProjectToAuthCore(projectId);
  const base = {
    engine: 'briven-engine' as const,
    storage: 'doltgres' as const,
    projectId: map.projectId,
    appId: map.appId,
    tenantId: map.tenantId,
  };

  if (!isAuthCoreInitialized()) {
    return {
      ...base,
      created: false,
      ok: false,
      message: 'briven-engine not ready on Doltgres',
    };
  }

  try {
    const pool = getEnginePool();
    const existing = await pool.query(
      `SELECT tenant_id FROM be_tenants WHERE tenant_id = $1 LIMIT 1`,
      [map.tenantId],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      return { ...base, created: false, ok: true, message: 'tenant exists' };
    }
    await pool.query(
      `INSERT INTO be_tenants (tenant_id, project_id) VALUES ($1, $2)`,
      [map.tenantId, map.projectId],
    );
    log.info('briven_engine_tenant_created', {
      tenantId: map.tenantId,
      projectId,
      storage: 'doltgres',
    });
    return { ...base, created: true, ok: true, message: 'tenant created on Doltgres' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...base, created: false, ok: false, message };
  }
}

export async function listBrivenEngineTenants(): Promise<{
  engine: 'briven-engine';
  tenantIds: string[];
  tenants: Array<{
    tenantId: string;
    projectId: string;
    createdAt: string | null;
    authEnabled: true;
  }>;
  ok: boolean;
  message?: string;
  storage: 'doltgres';
}> {
  if (!isAuthCoreInitialized()) {
    return {
      engine: 'briven-engine',
      storage: 'doltgres',
      tenantIds: [],
      tenants: [],
      ok: false,
      message: 'sdk not ready',
    };
  }
  try {
    const pool = getEnginePool();
    const res = await pool.query(
      `SELECT tenant_id, project_id, created_at FROM be_tenants ORDER BY created_at`,
    );
    const tenants = (
      res.rows as Array<{
        tenant_id: string;
        project_id: string;
        created_at: Date | string | null;
      }>
    ).map((r) => ({
      tenantId: r.tenant_id,
      projectId: r.project_id,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
      authEnabled: true as const,
    }));
    return {
      engine: 'briven-engine',
      storage: 'doltgres',
      tenantIds: tenants.map((t) => t.tenantId),
      tenants,
      ok: true,
    };
  } catch (err) {
    return {
      engine: 'briven-engine',
      storage: 'doltgres',
      tenantIds: [],
      tenants: [],
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
