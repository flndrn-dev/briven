/**
 * briven-engine roles API for yellow Auth dashboard (Phase 6).
 * Platform operator session required.
 */

import { Hono } from 'hono';

import { requireAuthCoreDashboard } from '../middleware/auth-core-guard.js';
import { BRIVEN_ENGINE_ID, isAuthCoreInitialized } from '../services/auth-core/engine.js';
import {
  assignBrivenEngineRole,
  createBrivenEngineRole,
  getBrivenEngineUserRoles,
  listBrivenEngineRoles,
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
  const projectId = c.req.query('projectId') ?? undefined;
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
  return c.json(
    await createBrivenEngineRole(body.role, body.permissions ?? [], {
      projectId: body.projectId,
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
  return c.json(
    await assignBrivenEngineRole(body.userId, body.role, {
      projectId: body.projectId,
      tenantId: body.tenantId,
    }),
  );
});

authCoreRolesRouter.get('/v1/auth-core/users/:userId/roles', async (c) => {
  return c.json(
    await getBrivenEngineUserRoles(c.req.param('userId'), {
      projectId: c.req.query('projectId') ?? undefined,
      tenantId: c.req.query('tenantId') ?? undefined,
    }),
  );
});
