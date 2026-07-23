/**
 * Option B — briven-engine status surface.
 *
 *  - GET /v1/auth-core/info
 *  - GET /v1/auth-core/ready
 *  - GET /v1/auth-core/map/:projectId
 *
 * App login (password) is on auth-core-fdi (Phase 2). Platform login stays /v1/auth/*.
 */

import { Hono } from 'hono';

import { mapProjectToAuthCore } from '../services/auth-core/project-map.js';
import {
  BRIVEN_ENGINE_ID,
  BRIVEN_ENGINE_VERSION,
  probeBrivenEngine,
} from '../services/auth-core/engine.js';
import { getAuthEmailDeliveryStatus } from '../services/auth-core/delivery.js';
import type { AppEnv } from '../types/app-env.js';
import { BUILD_AT, BUILD_SHA } from './health.js';

export const authCoreStatusRouter = new Hono<AppEnv>();

authCoreStatusRouter.get('/v1/auth-core/info', async (c) => {
  const core = await probeBrivenEngine();
  const emailDelivery = getAuthEmailDeliveryStatus();
  return c.json({
    service: 'briven-auth-core',
    product: 'Briven Auth',
    engine: BRIVEN_ENGINE_ID,
    engineVersion: BRIVEN_ENGINE_VERSION,
    productStatus: 'phase7-tabs',
    notice:
      'login APIs + yellow dashboard (users/sessions/roles/keys/providers/enterprise) on Doltgres',
    buildSha: BUILD_SHA,
    buildAt: BUILD_AT,
    emailDelivery,
    ...core,
  });
});

authCoreStatusRouter.get('/v1/auth-core/ready', async (c) => {
  const core = await probeBrivenEngine();
  const emailDelivery = getAuthEmailDeliveryStatus();
  if (!core.ok) {
    return c.json(
      {
        status: 'not_ready',
        engine: BRIVEN_ENGINE_ID,
        engineVersion: BRIVEN_ENGINE_VERSION,
        emailDelivery,
        ...core,
      },
      503,
    );
  }
  return c.json({
    status: 'ready',
    engine: BRIVEN_ENGINE_ID,
    engineVersion: BRIVEN_ENGINE_VERSION,
    notice:
      'login APIs + yellow dashboard (users/sessions/roles/keys/providers/enterprise) on Doltgres',
    emailDelivery,
    ...core,
  });
});

/** Project id → tenant map (rule-based; no login). */
authCoreStatusRouter.get('/v1/auth-core/map/:projectId', (c) => {
  const projectId = c.req.param('projectId');
  try {
    return c.json({
      engine: BRIVEN_ENGINE_ID,
      appLoginReady: false,
      ...mapProjectToAuthCore(projectId),
    });
  } catch (err) {
    return c.json(
      {
        code: 'invalid_project_id',
        engine: BRIVEN_ENGINE_ID,
        message: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }
});
