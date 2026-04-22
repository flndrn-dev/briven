import { ForbiddenError, UnauthorizedError } from '@briven/shared';
import type { MiddlewareHandler } from 'hono';

import { resolveApiKey } from '../services/api-keys.js';
import { getProjectForUser } from '../services/projects.js';
import type { Session, User } from './session.js';

/**
 * Authorise a request scoped to `/v1/projects/:id/...` either by:
 *   1. A valid session whose user owns the project, OR
 *   2. An `Authorization: Bearer brk_...` header whose key matches `:id`.
 *
 * On success, sets `c.var.apiKeyId` (nullable) so downstream handlers can
 * record which credential triggered the action.
 */
export const requireProjectAuth = (): MiddlewareHandler => async (c, next) => {
  const projectId = c.req.param('id');
  if (!projectId) throw new ForbiddenError('missing project id');

  const user = c.get('user') as User | null;
  if (user) {
    // getProjectForUser throws 403/404 if the user isn't the owner — propagates
    // to the shared error handler.
    await getProjectForUser(projectId, user.id);
    c.set('apiKeyId', null);
    await next();
    return;
  }

  const auth = c.req.header('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
  if (!token || !token.startsWith('brk_')) {
    throw new UnauthorizedError();
  }

  const resolved = await resolveApiKey(token);
  if (!resolved) throw new UnauthorizedError('invalid or revoked api key');
  if (resolved.projectId !== projectId) {
    throw new ForbiddenError('api key does not belong to this project');
  }

  c.set('apiKeyId', resolved.keyId);
  await next();
};

export type { Session, User };
