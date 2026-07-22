/**
 * Phase 1 (Option B) — briven-engine status only.
 *
 * Mounted product surface for Auth shell:
 *  - GET /v1/auth-core/info
 *  - GET /v1/auth-core/ready
 *  - GET /v1/auth-core/map/:projectId
 *
 * Does NOT open app login (no FDI signup/signin, no enable, no dashboard data).
 * Platform operator login stays on /v1/auth/* (Better Auth).
 */

import { Hono } from 'hono';

import { mapProjectToAuthCore } from '../services/auth-core/project-map.js';
import {
  BRIVEN_ENGINE_ID,
  BRIVEN_ENGINE_VERSION,
  probeBrivenEngine,
} from '../services/auth-core/engine.js';
import type { AppEnv } from '../types/app-env.js';
import { BUILD_AT, BUILD_SHA } from './health.js';

export const authCoreStatusRouter = new Hono<AppEnv>();

authCoreStatusRouter.get('/v1/auth-core/info', async (c) => {
  const core = await probeBrivenEngine();
  return c.json({
    service: 'briven-auth-core',
    product: 'Briven Auth',
    engine: BRIVEN_ENGINE_ID,
    engineVersion: BRIVEN_ENGINE_VERSION,
    productStatus: 'phase1-shell',
    appLoginReady: false,
    notice: 'not ready for app login yet',
    buildSha: BUILD_SHA,
    buildAt: BUILD_AT,
    ...core,
  });
});

authCoreStatusRouter.get('/v1/auth-core/ready', async (c) => {
  const core = await probeBrivenEngine();
  if (!core.ok) {
    return c.json(
      {
        status: 'not_ready',
        engine: BRIVEN_ENGINE_ID,
        engineVersion: BRIVEN_ENGINE_VERSION,
        appLoginReady: false,
        ...core,
      },
      503,
    );
  }
  // Schema/pool ready ≠ app login open (Phase 1 shell only).
  return c.json({
    status: 'ready',
    engine: BRIVEN_ENGINE_ID,
    engineVersion: BRIVEN_ENGINE_VERSION,
    appLoginReady: false,
    notice: 'not ready for app login yet',
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
