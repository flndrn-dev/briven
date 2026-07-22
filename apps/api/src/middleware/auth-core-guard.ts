/**
 * Guards for briven-engine dashboard/admin APIs.
 *
 * - requireAuthCoreDashboard: must be signed in to briven.tech (platform session)
 * - requireAuthCoreProject: must have access to :projectId (session or project API key)
 *
 * Customer login FDI (/v1/auth-core/fdi/*) stays public — those are app end-users.
 * DEPLOY GATE: still local-only until complete product ships.
 */

import type { MiddlewareHandler } from 'hono';

import { requireAuth } from './session.js';
import { requireProjectAuth, requireProjectRole } from './project-auth.js';
import { BRIVEN_ENGINE_ID } from '../services/auth-core/engine.js';

/** Platform operator / dashboard session required. */
export const requireAuthCoreDashboard = (): MiddlewareHandler => {
  const inner = requireAuth();
  return async (c, next) => {
    // Brand unauthorized responses as briven-engine product surface
    const user = c.get('user');
    if (!user && !c.get('apiKeyId')) {
      const authHeader = c.req.header('authorization');
      if (!authHeader) {
        return c.json(
          {
            code: 'unauthorized',
            message: 'authentication required',
            engine: BRIVEN_ENGINE_ID,
          },
          401,
        );
      }
    }
    return inner(c, next);
  };
};

/**
 * Project-scoped write/config for briven-engine.
 * Path param must be named `projectId`.
 */
export const requireAuthCoreProject = (
  minRole: 'viewer' | 'developer' | 'admin' = 'admin',
): MiddlewareHandler[] => {
  return [requireProjectAuth('projectId'), requireProjectRole(minRole)];
};
