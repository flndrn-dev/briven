/**
 * Briven Auth Core public routes (briven-engine on Doltgres).
 *
 *  - GET /v1/auth-core/info  — engine status (no secrets)
 *  - GET /v1/auth-core/ready — health
 *  - GET /v1/auth-core/map/:projectId — project → tenant map
 *  - Legacy multi-tenant Better Auth product paths → 410 Gone
 *  - Enable Auth is bridged to briven-engine (not 410)
 *
 * Platform operator login (/v1/auth/* Better Auth for briven.tech) is NOT here.
 */

import { Hono } from 'hono';

import { requireAuth } from '../middleware/session.js';
import {
  requireProjectAuth,
  requireProjectRole,
} from '../middleware/project-auth.js';
import { BUILD_AT, BUILD_SHA } from './health.js';
import { mapProjectToAuthCore } from '../services/auth-core/project-map.js';
import {
  BRIVEN_ENGINE_ID,
  probeBrivenEngine,
} from '../services/auth-core/engine.js';
import {
  disableBrivenEngineAuth,
  enableBrivenEngineAuth,
  listBrivenEngineWorkspace,
} from '../services/auth-core/workspace.js';
import type { AppEnv } from '../types/app-env.js';

export const authCoreRouter = new Hono<AppEnv>();

const GONE = {
  code: 'auth_product_retired',
  message:
    'That Auth path was retired. Use Briven Auth (briven-engine) under /v1/auth-core/*.',
  engine: BRIVEN_ENGINE_ID,
} as const;

authCoreRouter.get('/v1/auth-core/info', async (c) => {
  const core = await probeBrivenEngine();
  return c.json({
    service: 'briven-auth-core',
    product: 'Briven Auth',
    engine: BRIVEN_ENGINE_ID,
    productStatus: 'live-on-briven-engine',
    buildSha: BUILD_SHA,
    buildAt: BUILD_AT,
    ...core,
  });
});

authCoreRouter.get('/v1/auth-core/ready', async (c) => {
  const core = await probeBrivenEngine();
  if (!core.ok) {
    return c.json({ status: 'not_ready', ...core }, 503);
  }
  return c.json({ status: 'ready', engine: BRIVEN_ENGINE_ID, ...core });
});

/** Phase 1.4 — projectId → briven-engine appId/tenantId (rule-based until Multitenancy). */
authCoreRouter.get('/v1/auth-core/map/:projectId', (c) => {
  const projectId = c.req.param('projectId');
  try {
    return c.json(mapProjectToAuthCore(projectId));
  } catch (err) {
    return c.json(
      {
        code: 'invalid_project_id',
        message: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }
});

/**
 * Dashboard workspace — projects + Auth on/off (Doltgres tenants).
 * Replaces legacy /v1/auth-v2/workspace.
 */
authCoreRouter.get(
  '/v1/auth-core/workspace',
  requireAuth(),
  async (c) => {
    const user = c.get('user');
    if (!user?.id) {
      return c.json(
        { code: 'unauthorized', message: 'sign in required', engine: BRIVEN_ENGINE_ID },
        401,
      );
    }
    const data = await listBrivenEngineWorkspace(user.id);
    return c.json({ ok: true, ...data });
  },
);

/**
 * Enable Auth for a project — creates briven-engine tenant on Doltgres.
 * Also available as POST /v1/projects/:id/auth/enable (bridge below).
 */
authCoreRouter.post(
  '/v1/auth-core/projects/:projectId/enable',
  ...[requireProjectAuth('projectId'), requireProjectRole('admin')],
  async (c) => {
    const projectId = c.req.param('projectId');
    const result = await enableBrivenEngineAuth(projectId);
    return c.json(result, result.ok ? 200 : 503);
  },
);

/**
 * Disable Auth for a project (soft). User data stays; enable again anytime.
 */
authCoreRouter.post(
  '/v1/auth-core/projects/:projectId/disable',
  ...[requireProjectAuth('projectId'), requireProjectRole('admin')],
  async (c) => {
    const projectId = c.req.param('projectId');
    const result = await disableBrivenEngineAuth(projectId);
    return c.json(result, result.ok ? 200 : 503);
  },
);

/**
 * Bridge: dashboard "enable Auth" buttons still call the old path.
 * Do NOT return 410 — wire to briven-engine instead.
 */
authCoreRouter.post(
  '/v1/projects/:id/auth/enable',
  ...[requireProjectAuth('id'), requireProjectRole('admin')],
  async (c) => {
    const projectId = c.req.param('id');
    const result = await enableBrivenEngineAuth(projectId);
    if (!result.ok) {
      return c.json(
        {
          code: 'auth_enable_failed',
          message: result.message ?? 'could not enable Auth on briven-engine',
          engine: BRIVEN_ENGINE_ID,
        },
        503,
      );
    }
    return c.json({
      ok: true,
      engine: BRIVEN_ENGINE_ID,
      projectId: result.projectId,
      tenantId: result.tenantId,
      authEnabled: true,
      created: result.created,
      message: result.created
        ? 'Auth enabled for this project'
        : 'Auth already on for this project',
      storage: 'doltgres',
    });
  },
);

authCoreRouter.post(
  '/v1/projects/:id/auth/disable',
  ...[requireProjectAuth('id'), requireProjectRole('admin')],
  async (c) => {
    const projectId = c.req.param('id');
    const result = await disableBrivenEngineAuth(projectId);
    if (!result.ok) {
      return c.json(
        {
          code: 'auth_disable_failed',
          message: result.message ?? 'could not disable Auth',
          engine: BRIVEN_ENGINE_ID,
        },
        503,
      );
    }
    return c.json({
      ok: true,
      engine: BRIVEN_ENGINE_ID,
      projectId: result.projectId,
      tenantId: result.tenantId,
      authEnabled: false,
      message: result.message ?? 'Auth disabled for this project',
      storage: 'doltgres',
    });
  },
);

/**
 * Bridge: workspace list for older UI that still hits auth-v2.
 */
authCoreRouter.get('/v1/auth-v2/workspace', requireAuth(), async (c) => {
  const user = c.get('user');
  if (!user?.id) {
    return c.json({ code: 'unauthorized' }, 401);
  }
  const data = await listBrivenEngineWorkspace(user.id);
  return c.json({ ok: true, engine: 'briven-engine', projects: data.projects });
});

/** Old multi-tenant Better Auth product — gone (except enable + workspace bridges above). */
authCoreRouter.all('/v1/auth-tenant/*', (c) => c.json(GONE, 410));
// Note: GET /v1/auth-v2/workspace is registered above; other auth-v2 paths stay retired.
authCoreRouter.all('/v1/auth-v2/*', (c) => c.json(GONE, 410));
// Note: POST /v1/projects/:id/auth/enable is registered above; other project auth paths retired.
authCoreRouter.all('/v1/projects/:id/auth/*', (c) =>
  c.json(
    {
      ...GONE,
      message:
        'Use Briven Auth under /dashboard/auth and /v1/auth-core/* for this action.',
    },
    410,
  ),
);
authCoreRouter.all('/v1/projects/:id/scim/*', (c) => c.json(GONE, 410));
