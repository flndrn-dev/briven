/**
 * briven-engine users API — list, detail, hold, archive, delete, revoke sessions.
 *
 *  GET    /v1/auth-core/users
 *  GET    /v1/auth-core/users/:userId
 *  GET    /v1/auth-core/users/:userId/metadata
 *  PUT    /v1/auth-core/users/:userId/metadata
 *  POST   /v1/auth-core/users/:userId/hold
 *  POST   /v1/auth-core/users/:userId/unhold
 *  POST   /v1/auth-core/users/:userId/archive
 *  POST   /v1/auth-core/users/:userId/unarchive
 *  POST   /v1/auth-core/users/:userId/delete
 *  POST   /v1/auth-core/users/:userId/sessions/revoke-all
 *  POST   /v1/auth-core/users/:userId/sessions/:sessionHandle/revoke
 */

import { Hono } from 'hono';

import { requireAuthCoreDashboard } from '../middleware/auth-core-guard.js';
import { BRIVEN_ENGINE_ID, isAuthCoreInitialized } from '../services/auth-core/engine.js';
import {
  archiveBrivenEngineUser,
  deleteBrivenEngineUser,
  getBrivenEngineUser,
  getBrivenEngineUserMetadata,
  holdBrivenEngineUser,
  listBrivenEngineUsers,
  unarchiveBrivenEngineUser,
  unholdBrivenEngineUser,
  updateBrivenEngineUserMetadata,
} from '../services/auth-core/users.js';
import {
  revokeAllSessionsForUser,
  revokeSession,
} from '../services/auth-core/session.js';
import type { AppEnv } from '../types/app-env.js';

export const authCoreUsersRouter = new Hono<AppEnv>();

authCoreUsersRouter.use('/v1/auth-core/users', requireAuthCoreDashboard());
authCoreUsersRouter.use('/v1/auth-core/users/*', requireAuthCoreDashboard());

async function resolveTenantId(
  projectId: string | undefined,
  tenantId: string | undefined,
): Promise<string | undefined> {
  if (tenantId) return tenantId;
  if (!projectId) return undefined;
  try {
    const { projectIdToTenantId } = await import(
      '../services/auth-core/project-map.js'
    );
    return projectIdToTenantId(projectId);
  } catch {
    return undefined;
  }
}

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
  const tenantId = await resolveTenantId(
    projectId,
    c.req.query('tenantId') ?? undefined,
  );
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

authCoreUsersRouter.get('/v1/auth-core/users/:userId', async (c) => {
  if (!isAuthCoreInitialized()) {
    return c.json({ engine: BRIVEN_ENGINE_ID, code: 'auth_core_sdk_not_ready' }, 503);
  }
  const userId = c.req.param('userId');
  const projectId = c.req.query('projectId') ?? undefined;
  const tenantId = await resolveTenantId(
    projectId,
    c.req.query('tenantId') ?? undefined,
  );
  const user = await getBrivenEngineUser(userId, { tenantId });
  if (!user) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, code: 'not_found', message: 'user not found' },
      404,
    );
  }
  return c.json({ engine: BRIVEN_ENGINE_ID, user, projectId: projectId ?? null });
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

async function moderationBody(c: {
  req: { json: () => Promise<unknown> };
}): Promise<{ reason?: string; projectId?: string; confirm?: string }> {
  try {
    const body = (await c.req.json()) as {
      reason?: string;
      projectId?: string;
      confirm?: string;
    };
    return body ?? {};
  } catch {
    return {};
  }
}

authCoreUsersRouter.post('/v1/auth-core/users/:userId/hold', async (c) => {
  const userId = c.req.param('userId');
  const body = await moderationBody(c);
  const projectId = body.projectId ?? c.req.query('projectId') ?? undefined;
  const tenantId = await resolveTenantId(projectId, undefined);
  const ok = await holdBrivenEngineUser(userId, {
    reason: body.reason,
    tenantId,
  });
  if (!ok) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, ok: false, code: 'hold_failed' },
      400,
    );
  }
  return c.json({ engine: BRIVEN_ENGINE_ID, ok: true, userId, status: 'held' });
});

authCoreUsersRouter.post('/v1/auth-core/users/:userId/unhold', async (c) => {
  const userId = c.req.param('userId');
  const body = await moderationBody(c);
  const projectId = body.projectId ?? c.req.query('projectId') ?? undefined;
  const tenantId = await resolveTenantId(projectId, undefined);
  const ok = await unholdBrivenEngineUser(userId, { tenantId });
  if (!ok) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, ok: false, code: 'unhold_failed' },
      400,
    );
  }
  return c.json({ engine: BRIVEN_ENGINE_ID, ok: true, userId, status: 'active' });
});

authCoreUsersRouter.post('/v1/auth-core/users/:userId/archive', async (c) => {
  const userId = c.req.param('userId');
  const body = await moderationBody(c);
  const projectId = body.projectId ?? c.req.query('projectId') ?? undefined;
  const tenantId = await resolveTenantId(projectId, undefined);
  const ok = await archiveBrivenEngineUser(userId, {
    reason: body.reason,
    tenantId,
  });
  if (!ok) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, ok: false, code: 'archive_failed' },
      400,
    );
  }
  return c.json({
    engine: BRIVEN_ENGINE_ID,
    ok: true,
    userId,
    status: 'archived',
  });
});

authCoreUsersRouter.post('/v1/auth-core/users/:userId/unarchive', async (c) => {
  const userId = c.req.param('userId');
  const body = await moderationBody(c);
  const projectId = body.projectId ?? c.req.query('projectId') ?? undefined;
  const tenantId = await resolveTenantId(projectId, undefined);
  const ok = await unarchiveBrivenEngineUser(userId, { tenantId });
  if (!ok) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, ok: false, code: 'unarchive_failed' },
      400,
    );
  }
  return c.json({ engine: BRIVEN_ENGINE_ID, ok: true, userId, status: 'active' });
});

authCoreUsersRouter.post('/v1/auth-core/users/:userId/delete', async (c) => {
  const userId = c.req.param('userId');
  const body = await moderationBody(c);
  const projectId = body.projectId ?? c.req.query('projectId') ?? undefined;
  const tenantId = await resolveTenantId(projectId, undefined);
  // Safety: require explicit confirm in body
  if (body.confirm !== 'delete') {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        ok: false,
        code: 'confirm_required',
        message: 'send { "confirm": "delete" } to permanently delete',
      },
      400,
    );
  }
  const ok = await deleteBrivenEngineUser(userId, { tenantId });
  if (!ok) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, ok: false, code: 'delete_failed' },
      400,
    );
  }
  return c.json({ engine: BRIVEN_ENGINE_ID, ok: true, userId, deleted: true });
});

authCoreUsersRouter.post(
  '/v1/auth-core/users/:userId/sessions/revoke-all',
  async (c) => {
    const userId = c.req.param('userId');
    const body = await moderationBody(c);
    const projectId = body.projectId ?? c.req.query('projectId') ?? undefined;
    const tenantId = await resolveTenantId(projectId, undefined);
    // Scope: ensure user belongs to tenant when project provided
    if (tenantId) {
      const user = await getBrivenEngineUser(userId, { tenantId });
      if (!user) {
        return c.json(
          { engine: BRIVEN_ENGINE_ID, code: 'not_found' },
          404,
        );
      }
    }
    const n = await revokeAllSessionsForUser(userId);
    return c.json({
      engine: BRIVEN_ENGINE_ID,
      ok: true,
      userId,
      revoked: n,
    });
  },
);

authCoreUsersRouter.post(
  '/v1/auth-core/users/:userId/sessions/:sessionHandle/revoke',
  async (c) => {
    const userId = c.req.param('userId');
    const sessionHandle = c.req.param('sessionHandle');
    const body = await moderationBody(c);
    const projectId = body.projectId ?? c.req.query('projectId') ?? undefined;
    const tenantId = await resolveTenantId(projectId, undefined);
    if (tenantId) {
      const user = await getBrivenEngineUser(userId, { tenantId });
      if (!user) {
        return c.json(
          { engine: BRIVEN_ENGINE_ID, code: 'not_found' },
          404,
        );
      }
    }
    // Only revoke if session belongs to this user
    const detail = await getBrivenEngineUser(userId, { tenantId });
    const owns = detail?.sessions.some((s) => s.handle === sessionHandle);
    if (!owns) {
      // still try revoke by handle if list is empty due to race
      const ok = await revokeSession(sessionHandle);
      return c.json({
        engine: BRIVEN_ENGINE_ID,
        ok,
        userId,
        sessionHandle,
        revoked: ok ? 1 : 0,
      });
    }
    const ok = await revokeSession(sessionHandle);
    return c.json({
      engine: BRIVEN_ENGINE_ID,
      ok,
      userId,
      sessionHandle,
      revoked: ok ? 1 : 0,
    });
  },
);
