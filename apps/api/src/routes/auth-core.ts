/**
 * Briven Auth Core public routes (Path A — SuperTokens under Briven).
 *
 * Phase 1:
 *  - GET /v1/auth-core/info  — engine status (no secrets)
 *  - GET /v1/auth-core/ready — health
 *  - GET /v1/auth-core/map/:projectId — project → ST tenant map
 *  - ALL legacy customer auth product paths → 410 Gone (wipe)
 *
 * Phase 2 FDI lives in auth-core-fdi.ts (/v1/auth-core/fdi/*).
 *
 * Platform operator login (/v1/auth/* Better Auth for briven.tech) is NOT here.
 */

import { Hono } from 'hono';

import { BUILD_AT, BUILD_SHA } from './health.js';
import { mapProjectToAuthCore } from '../services/auth-core/project-map.js';
import {
  BRIVEN_ENGINE_ID,
  probeBrivenEngine,
} from '../services/auth-core/engine.js';
import type { AppEnv } from '../types/app-env.js';

export const authCoreRouter = new Hono<AppEnv>();

const GONE = {
  code: 'auth_product_rebuilding',
  message:
    'Briven Auth is being rebuilt from zero on briven-engine. The old Auth product is retired. See BRIVEN-AUTH-FROM-ZERO-PLAN.md.',
  engine: BRIVEN_ENGINE_ID,
  phase: 1,
} as const;

authCoreRouter.get('/v1/auth-core/info', async (c) => {
  const core = await probeBrivenEngine();
  return c.json({
    service: 'briven-auth-core',
    product: 'Briven Auth',
    engine: BRIVEN_ENGINE_ID,
    rebuild: 'from-zero-briven-engine-path-a',
    buildSha: BUILD_SHA,
    buildAt: BUILD_AT,
    plan: 'BRIVEN-AUTH-FROM-ZERO-PLAN.md',
    deployGate: 'no-deploy-until-complete-briven-auth',
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

/** Old multi-tenant Better Auth product — gone. */
authCoreRouter.all('/v1/auth-tenant/*', (c) => c.json(GONE, 410));
authCoreRouter.all('/v1/auth-v2/*', (c) => c.json(GONE, 410));
authCoreRouter.all('/v1/projects/:id/auth/*', (c) => c.json(GONE, 410));
authCoreRouter.all('/v1/projects/:id/scim/*', (c) => c.json(GONE, 410));
