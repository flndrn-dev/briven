/**
 * briven-engine roles + permissions on Doltgres.
 */

import { getEnginePool } from './db.js';
import { isAuthCoreInitialized } from './engine.js';
import { projectIdToTenantId } from './project-map.js';

async function ensureTenant(tenantId: string, projectId?: string): Promise<void> {
  const pool = getEnginePool();
  const existing = await pool.query(
    `SELECT tenant_id FROM be_tenants WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  if (!existing.rowCount) {
    await pool.query(
      `INSERT INTO be_tenants (tenant_id, project_id) VALUES ($1, $2)`,
      [tenantId, projectId ?? tenantId],
    );
  }
}

export async function createBrivenEngineRole(
  role: string,
  permissions: string[] = [],
  opts?: { projectId?: string; tenantId?: string },
): Promise<{ ok: boolean; engine: 'briven-engine'; storage: 'doltgres'; message?: string }> {
  if (!isAuthCoreInitialized()) {
    return {
      ok: false,
      engine: 'briven-engine',
      storage: 'doltgres',
      message: 'engine not ready',
    };
  }
  const name = role.trim().toLowerCase();
  if (!name) {
    return {
      ok: false,
      engine: 'briven-engine',
      storage: 'doltgres',
      message: 'role required',
    };
  }
  const tenantId =
    opts?.tenantId ??
    (opts?.projectId ? projectIdToTenantId(opts.projectId) : 'public');
  await ensureTenant(tenantId, opts?.projectId);
  const pool = getEnginePool();
  const existing = await pool.query(
    `SELECT role_name FROM be_roles WHERE tenant_id = $1 AND role_name = $2 LIMIT 1`,
    [tenantId, name],
  );
  if (existing.rowCount) {
    await pool.query(
      `UPDATE be_roles SET permissions_json = $3 WHERE tenant_id = $1 AND role_name = $2`,
      [tenantId, name, JSON.stringify(permissions)],
    );
    return {
      ok: true,
      engine: 'briven-engine',
      storage: 'doltgres',
      message: 'updated',
    };
  }
  await pool.query(
    `INSERT INTO be_roles (tenant_id, role_name, permissions_json)
     VALUES ($1, $2, $3)`,
    [tenantId, name, JSON.stringify(permissions)],
  );
  return {
    ok: true,
    engine: 'briven-engine',
    storage: 'doltgres',
    message: 'created',
  };
}

export async function assignBrivenEngineRole(
  userId: string,
  role: string,
  opts?: { projectId?: string; tenantId?: string },
): Promise<{ ok: boolean; engine: 'briven-engine'; storage: 'doltgres'; message?: string }> {
  if (!isAuthCoreInitialized()) {
    return {
      ok: false,
      engine: 'briven-engine',
      storage: 'doltgres',
      message: 'engine not ready',
    };
  }
  const name = role.trim().toLowerCase();
  const tenantId =
    opts?.tenantId ??
    (opts?.projectId ? projectIdToTenantId(opts.projectId) : 'public');
  const pool = getEnginePool();
  const roleRow = await pool.query(
    `SELECT role_name FROM be_roles WHERE tenant_id = $1 AND role_name = $2 LIMIT 1`,
    [tenantId, name],
  );
  if (!roleRow.rowCount) {
    return {
      ok: false,
      engine: 'briven-engine',
      storage: 'doltgres',
      message: 'role does not exist',
    };
  }
  const has = await pool.query(
    `SELECT 1 FROM be_user_roles WHERE tenant_id = $1 AND user_id = $2 AND role_name = $3`,
    [tenantId, userId, name],
  );
  if (!has.rowCount) {
    await pool.query(
      `INSERT INTO be_user_roles (tenant_id, user_id, role_name) VALUES ($1, $2, $3)`,
      [tenantId, userId, name],
    );
  }
  return { ok: true, engine: 'briven-engine', storage: 'doltgres', message: 'assigned' };
}

export async function getBrivenEngineUserRoles(
  userId: string,
  opts?: { projectId?: string; tenantId?: string },
): Promise<{
  roles: string[];
  permissions: string[];
  engine: 'briven-engine';
  storage: 'doltgres';
}> {
  if (!isAuthCoreInitialized()) {
    return {
      roles: [],
      permissions: [],
      engine: 'briven-engine',
      storage: 'doltgres',
    };
  }
  const tenantId =
    opts?.tenantId ??
    (opts?.projectId ? projectIdToTenantId(opts.projectId) : 'public');
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT ur.role_name, r.permissions_json
     FROM be_user_roles ur
     JOIN be_roles r ON r.tenant_id = ur.tenant_id AND r.role_name = ur.role_name
     WHERE ur.tenant_id = $1 AND ur.user_id = $2`,
    [tenantId, userId],
  );
  const roles: string[] = [];
  const permSet = new Set<string>();
  for (const row of res.rows as Array<{
    role_name: string;
    permissions_json: string;
  }>) {
    roles.push(row.role_name);
    try {
      const perms = JSON.parse(row.permissions_json) as string[];
      for (const p of perms) permSet.add(p);
    } catch {
      /* ignore */
    }
  }
  return {
    roles,
    permissions: [...permSet],
    engine: 'briven-engine',
    storage: 'doltgres',
  };
}

export async function listBrivenEngineRoles(opts?: {
  projectId?: string;
  tenantId?: string;
}): Promise<{
  roles: Array<{ name: string; permissions: string[]; tenantId: string }>;
  engine: 'briven-engine';
  storage: 'doltgres';
}> {
  if (!isAuthCoreInitialized()) {
    return { roles: [], engine: 'briven-engine', storage: 'doltgres' };
  }
  const pool = getEnginePool();
  // Dashboard (no filter): all tenants. With project/tenant: that slice only.
  const scoped =
    opts?.tenantId ??
    (opts?.projectId ? projectIdToTenantId(opts.projectId) : null);
  const res = scoped
    ? await pool.query(
        `SELECT tenant_id, role_name, permissions_json FROM be_roles
         WHERE tenant_id = $1 ORDER BY role_name`,
        [scoped],
      )
    : await pool.query(
        `SELECT tenant_id, role_name, permissions_json FROM be_roles
         ORDER BY tenant_id, role_name`,
      );
  return {
    engine: 'briven-engine',
    storage: 'doltgres',
    roles: (
      res.rows as Array<{
        tenant_id: string;
        role_name: string;
        permissions_json: string;
      }>
    ).map((r) => {
      let permissions: string[] = [];
      try {
        permissions = JSON.parse(r.permissions_json) as string[];
      } catch {
        permissions = [];
      }
      return {
        name: r.role_name,
        permissions,
        tenantId: r.tenant_id,
      };
    }),
  };
}

export async function userHasPermission(
  userId: string,
  permission: string,
  opts?: { projectId?: string; tenantId?: string },
): Promise<boolean> {
  const { permissions } = await getBrivenEngineUserRoles(userId, opts);
  return permissions.includes(permission) || permissions.includes('*');
}
