import { Hono } from 'hono';

import { projectRateLimit } from '../middleware/rate-limit.js';
import { requireProjectAuth, requireProjectRole } from '../middleware/project-auth.js';
import { invoke } from '../services/invoke.js';
import type { ProjectAppEnv as AppEnv } from '../types/app-env.js';

export const invokeRouter = new Hono<AppEnv>();

// Tier-aware burst limit. Runs BEFORE auth so an unauthenticated flood
// can't drive the auth path; the helper returns null when the project
// doesn't exist, which the middleware treats as a pass-through (the
// auth check below 401s anyway).
invokeRouter.use('/v1/projects/:id/functions/:name', projectRateLimit('invoke'));

// Functions are project-scoped resources, so they share project-auth with
// deployments and api-keys: either a session-bound owner or a matching brk_.
invokeRouter.use('/v1/projects/:id/functions/:name', requireProjectAuth());

// Suspension gating happens once at app level (apps/api/src/index.ts) via
// blockIfProjectSuspended mounted on /v1/projects/:id/*.

// Function invocations require developer minimum (writes through user code).
invokeRouter.post(
  '/v1/projects/:id/functions/:name',
  requireProjectRole('developer'),
  async (c) => {
    const projectId = c.req.param('id');
    const functionName = c.req.param('name');
    const user = c.get('user');
    const apiKeyId = c.get('apiKeyId');
    const requestId = c.get('requestId');

    const raw = await c.req.text();
    let args: unknown = null;
    if (raw.length > 0) {
      try {
        args = JSON.parse(raw);
      } catch {
        return c.json({ code: 'invalid_json', message: 'request body is not valid json' }, 400);
      }
    }

    const result = await invoke({
      projectId,
      functionName,
      args,
      requestId,
      auth: user
        ? { userId: user.id, tokenType: apiKeyId ? 'api_key' : 'session' }
        : apiKeyId
          ? { userId: `key:${apiKeyId}`, tokenType: 'api_key' }
          : null,
    });

    const status = result.ok ? 200 : 500;
    return c.json(result, status);
  },
);
