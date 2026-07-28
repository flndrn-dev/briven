/**
 * briven-engine roles API for yellow Auth dashboard (Phase 6).
 * Platform operator session required.
 */

import { Hono } from 'hono';

import { requireAuthCoreDashboard } from '../middleware/auth-core-guard.js';
import { requireDashboardProjectAdmin } from '../services/auth-core/dashboard-project-auth.js';
import { BRIVEN_ENGINE_ID, isAuthCoreInitialized } from '../services/auth-core/engine.js';
import {
  assignBrivenEngineRole,
  createBrivenEngineRole,
  deleteBrivenEngineRole,
  getBrivenEngineUserRoles,
  listBrivenEngineRoles,
  unassignBrivenEngineRole,
} from '../services/auth-core/roles.js';
import type { AppEnv } from '../types/app-env.js';

export const authCoreRolesRouter = new Hono<AppEnv>();

authCoreRolesRouter.use('/v1/auth-core/roles', requireAuthCoreDashboard());
authCoreRolesRouter.use('/v1/auth-core/roles/*', requireAuthCoreDashboard());
authCoreRolesRouter.use('/v1/auth-core/users/*/roles', requireAuthCoreDashboard());

authCoreRolesRouter.get('/v1/auth-core/roles', async (c) => {
  if (!isAuthCoreInitialized()) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, roles: [], code: 'auth_core_sdk_not_ready' },
      503,
    );
  }
  const projectGate = await requireDashboardProjectAdmin(
    c,
    c.req.query('projectId'),
  );
  if (projectGate instanceof Response) return projectGate;
  const projectId = projectGate.projectId;
  const tenantId = c.req.query('tenantId') ?? undefined;
  return c.json(await listBrivenEngineRoles({ projectId, tenantId }));
});

authCoreRolesRouter.post('/v1/auth-core/roles', async (c) => {
  let body: {
    role?: string;
    permissions?: string[];
    projectId?: string;
    tenantId?: string;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!body.role) {
    return c.json({ engine: BRIVEN_ENGINE_ID, code: 'role_required' }, 400);
  }
  const projectGate = await requireDashboardProjectAdmin(c, body.projectId);
  if (projectGate instanceof Response) return projectGate;
  return c.json(
    await createBrivenEngineRole(body.role, body.permissions ?? [], {
      projectId: projectGate.projectId,
      tenantId: body.tenantId,
    }),
  );
});

authCoreRolesRouter.post('/v1/auth-core/roles/assign', async (c) => {
  let body: {
    userId?: string;
    role?: string;
    projectId?: string;
    tenantId?: string;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!body.userId || !body.role) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, code: 'userId_and_role_required' },
      400,
    );
  }
  const projectGate = await requireDashboardProjectAdmin(c, body.projectId);
  if (projectGate instanceof Response) return projectGate;
  return c.json(
    await assignBrivenEngineRole(body.userId, body.role, {
      projectId: projectGate.projectId,
      tenantId: body.tenantId,
    }),
  );
});

authCoreRolesRouter.post('/v1/auth-core/roles/unassign', async (c) => {
  let body: {
    userId?: string;
    role?: string;
    projectId?: string;
    tenantId?: string;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!body.userId || !body.role) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, code: 'userId_and_role_required' },
      400,
    );
  }
  const projectGate = await requireDashboardProjectAdmin(c, body.projectId);
  if (projectGate instanceof Response) return projectGate;
  return c.json(
    await unassignBrivenEngineRole(body.userId, body.role, {
      projectId: projectGate.projectId,
      tenantId: body.tenantId,
    }),
  );
});

authCoreRolesRouter.delete('/v1/auth-core/roles', async (c) => {
  let body: { role?: string; projectId?: string; tenantId?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  // Also allow ?role=&projectId=
  const role = body.role ?? c.req.query('role') ?? undefined;
  const projectId = body.projectId ?? c.req.query('projectId') ?? undefined;
  if (!role) {
    return c.json({ engine: BRIVEN_ENGINE_ID, code: 'role_required' }, 400);
  }
  const projectGate = await requireDashboardProjectAdmin(c, projectId);
  if (projectGate instanceof Response) return projectGate;
  return c.json(
    await deleteBrivenEngineRole(role, {
      projectId: projectGate.projectId,
      tenantId: body.tenantId ?? c.req.query('tenantId') ?? undefined,
    }),
  );
});

authCoreRolesRouter.get('/v1/auth-core/users/:userId/roles', async (c) => {
  const projectGate = await requireDashboardProjectAdmin(
    c,
    c.req.query('projectId'),
  );
  if (projectGate instanceof Response) return projectGate;
  return c.json(
    await getBrivenEngineUserRoles(c.req.param('userId'), {
      projectId: projectGate.projectId,
      tenantId: c.req.query('tenantId') ?? undefined,
    }),
  );
});
