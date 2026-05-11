import { ForbiddenError } from '@briven/shared';
import type { MiddlewareHandler } from 'hono';

import { getProjectSuspension } from '../services/abuse.js';

/**
 * Gate state-changing project routes behind the suspension flag. Chain
 * this AFTER `requireProjectAuth` so the project id is already resolved
 * from the path param. Suspended projects 403 with code=project_suspended.
 *
 * Reads (GET) are intentionally not gated here — the operator + owner
 * still need to inspect the project's state via the dashboard while a
 * suspension is being investigated.
 *
 * Cache: not added in this version. At Phase 3 scale (~25 projects)
 * the extra round-trip is in the single-digit ms and avoids a stale-
 * cache window between suspend + the next invoke. Revisit when traffic
 * justifies it.
 */
export const blockIfProjectSuspended = (): MiddlewareHandler => async (c, next) => {
  const projectId = c.req.param('id');
  if (!projectId) {
    await next();
    return;
  }
  const suspension = await getProjectSuspension(projectId);
  if (suspension) {
    throw new ForbiddenError(
      'project is suspended — contact support to appeal',
      'project_suspended',
    );
  }
  await next();
};
