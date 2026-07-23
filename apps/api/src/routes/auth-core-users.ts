/**
 * briven-engine users API (Phase 5 surface).
 *
 *  GET  /v1/auth-core/users
 *  GET  /v1/auth-core/users/:userId/metadata
 *  PUT  /v1/auth-core/users/:userId/metadata
 */

import { Hono } from 'hono';

import { requireAuthCoreDashboard } from '../middleware/auth-core-guard.js';
import { BRIVEN_ENGINE_ID, isAuthCoreInitialized } from '../services/auth-core/engine.js';
import {
  getBrivenEngineUserMetadata,
  listBrivenEngineUsers,
  updateBrivenEngineUserMetadata,
} from '../services/auth-core/users.js';
import type { AppEnv } from '../types/app-env.js';

export const authCoreUsersRouter = new Hono<AppEnv>();

authCoreUsersRouter.use('/v1/auth-core/users', requireAuthCoreDashboard());
authCoreUsersRouter.use('/v1/auth-core/users/*', requireAuthCoreDashboard());

authCoreUsersRouter.get('/v1/auth-core/users', async (c) => {
  if (!isAuthCoreInitialized()) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, code: 'auth_core_sdk_not_ready', users: [] },
      503,
    );
  }
  const limit = Number(c.req.query('limit') ?? '50');
  const paginationToken = c.req.query('paginationToken') ?? undefined;
  const projectId = c.req.query('projectId') ?? undefined;
  let tenantId = c.req.query('tenantId') ?? undefined;
  if (!tenantId && projectId) {
    try {
      const { projectIdToTenantId } = await import(
        '../services/auth-core/project-map.js'
      );
      tenantId = projectIdToTenantId(projectId);
    } catch {
      tenantId = undefined;
    }
  }
  const result = await listBrivenEngineUsers({
    limit: Number.isFinite(limit) ? limit : 50,
    paginationToken,
    tenantId,
  });
  return c.json({
    ...result,
    projectId: projectId ?? null,
    tenantId: tenantId ?? null,
  });
});

authCoreUsersRouter.get('/v1/auth-core/users/:userId/metadata', async (c) => {
  const userId = c.req.param('userId');
  const metadata = await getBrivenEngineUserMetadata(userId);
  if (metadata == null && !isAuthCoreInitialized()) {
    return c.json({ engine: BRIVEN_ENGINE_ID, code: 'auth_core_sdk_not_ready' }, 503);
  }
  return c.json({ engine: BRIVEN_ENGINE_ID, userId, metadata: metadata ?? {} });
});

authCoreUsersRouter.put('/v1/auth-core/users/:userId/metadata', async (c) => {
  const userId = c.req.param('userId');
  let body: Record<string, unknown> = {};
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const ok = await updateBrivenEngineUserMetadata(userId, body);
  if (!ok) {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        ok: false,
        code: isAuthCoreInitialized() ? 'update_failed' : 'auth_core_sdk_not_ready',
      },
      isAuthCoreInitialized() ? 400 : 503,
    );
  }
  return c.json({ engine: BRIVEN_ENGINE_ID, ok: true, userId });
});
