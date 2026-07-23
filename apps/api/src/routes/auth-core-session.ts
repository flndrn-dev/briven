/**
 * Briven Auth Core — session admin/verify endpoints (Phase 2).
 *
 *  GET  /v1/auth-core/session/me     — verify current session (cookie/header)
 *  POST /v1/auth-core/session/revoke — revoke by handle or all for user
 *  GET  /v1/auth-core/session/list   — list handles for userId (query)
 */

import { Hono } from 'hono';

import { requireAuthCoreDashboard } from '../middleware/auth-core-guard.js';
import {
  listSessionsForUser,
  revokeAllSessionsForUser,
  revokeSession,
  verifyAuthCoreSession,
} from '../services/auth-core/session.js';
import { listRecentEngineSessions } from '../services/auth-core/native-session.js';
import {
  BRIVEN_ENGINE_ID,
  isAuthCoreInitialized,
} from '../services/auth-core/engine.js';
import type { AppEnv } from '../types/app-env.js';

export const authCoreSessionRouter = new Hono<AppEnv>();

// me = self-check via cookie (public to holders of session cookie)
// list/revoke/recent = dashboard only
authCoreSessionRouter.use('/v1/auth-core/session/list', requireAuthCoreDashboard());
authCoreSessionRouter.use('/v1/auth-core/session/revoke', requireAuthCoreDashboard());
authCoreSessionRouter.use('/v1/auth-core/session/recent', requireAuthCoreDashboard());

authCoreSessionRouter.get('/v1/auth-core/session/me', async (c) => {
  if (!isAuthCoreInitialized()) {
    return c.json({ code: 'auth_core_sdk_not_ready' }, 503);
  }

  const result = await verifyAuthCoreSession({
    url: c.req.url,
    method: c.req.method,
    headers: c.req.raw.headers,
    cookieHeader: c.req.header('cookie'),
  });

  if (!result.ok) {
    return c.json(
      { authenticated: false, reason: result.reason },
      (result.status as 401) ?? 401,
    );
  }

  const session = result.session;
  return c.json({
    authenticated: true,
    userId: session.getUserId(),
    sessionHandle: session.getHandle(),
    accessTokenPayload: session.getAccessTokenPayload(),
  });
});

authCoreSessionRouter.get('/v1/auth-core/session/list', async (c) => {
  if (!isAuthCoreInitialized()) {
    return c.json({ code: 'auth_core_sdk_not_ready' }, 503);
  }
  const userId = c.req.query('userId');
  if (!userId) {
    return c.json({ code: 'userId_required' }, 400);
  }
  const handles = await listSessionsForUser(userId);
  return c.json({ userId, handles, count: handles.length });
});

/** Yellow dashboard: recent active sessions across tenants. */
authCoreSessionRouter.get('/v1/auth-core/session/recent', async (c) => {
  if (!isAuthCoreInitialized()) {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        code: 'auth_core_sdk_not_ready',
        sessions: [],
      },
      503,
    );
  }
  const limit = Number(c.req.query('limit') ?? '50');
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
  const sessions = await listRecentEngineSessions(
    Number.isFinite(limit) ? limit : 50,
    tenantId ? { tenantId } : undefined,
  );
  return c.json({
    engine: BRIVEN_ENGINE_ID,
    storage: 'doltgres',
    projectId: projectId ?? null,
    tenantId: tenantId ?? null,
    sessions,
    count: sessions.length,
  });
});

authCoreSessionRouter.post('/v1/auth-core/session/revoke', async (c) => {
  if (!isAuthCoreInitialized()) {
    return c.json({ code: 'auth_core_sdk_not_ready' }, 503);
  }
  let body: { sessionHandle?: string; userId?: string; all?: boolean } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  if (body.all && body.userId) {
    const n = await revokeAllSessionsForUser(body.userId);
    return c.json({ revoked: n, userId: body.userId });
  }
  if (body.sessionHandle) {
    const ok = await revokeSession(body.sessionHandle);
    return c.json({ revoked: ok ? 1 : 0, sessionHandle: body.sessionHandle });
  }
  return c.json(
    { code: 'bad_request', message: 'Provide sessionHandle, or userId+all' },
    400,
  );
});
