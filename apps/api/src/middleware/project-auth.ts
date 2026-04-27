import { ForbiddenError, UnauthorizedError } from '@briven/shared';
import type { MiddlewareHandler } from 'hono';

import { hasRoleAtLeast } from '../services/access.js';
import { resolveApiKey } from '../services/api-keys.js';
import { getProjectAccessForUser } from '../services/projects.js';
import type { MemberRole } from '../db/schema.js';
import type { Session, User } from './session.js';

/**
 * Authorise a request scoped to `/v1/projects/:id/...` either by:
 *   1. A valid session whose user has access to the project (via either an
 *      `orgMembers` row for the project's org, OR a direct `projectMembers`
 *      row), OR
 *   2. An `Authorization: Bearer brk_...` header whose key matches `:id`.
 *
 * On success this middleware populates:
 *   - `c.var.apiKeyId` — non-null when authed via API key, null for session
 *   - `c.var.projectRole` — the effective `MemberRole` for session auth, or
 *     'admin' for API-key auth (api keys are project-scoped service accounts
 *     and inherit admin-equivalent privilege within their project; finer
 *     api-key scoping is a follow-up).
 *
 * Routes that need stricter gating chain `requireProjectRole(min)` after
 * this middleware.
 */
export const requireProjectAuth = (): MiddlewareHandler => async (c, next) => {
  const projectId = c.req.param('id');
  if (!projectId) throw new ForbiddenError('missing project id');

  const user = c.get('user') as User | null;
  if (user) {
    const access = await getProjectAccessForUser(projectId, user.id);
    c.set('apiKeyId', null);
    c.set('projectRole', access.role);
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
  c.set('projectRole', 'admin' satisfies MemberRole);
  await next();
};

/**
 * Gate a route on a minimum `MemberRole`. Must follow `requireProjectAuth`
 * in the chain (which populates `projectRole`). API-key authenticated
 * requests carry role='admin' so they pass any gate up to admin; routes
 * that should refuse api keys outright should add an explicit check on
 * `c.get('apiKeyId')`.
 */
export const requireProjectRole =
  (min: MemberRole): MiddlewareHandler =>
  async (c, next) => {
    const role = c.get('projectRole') as MemberRole | null | undefined;
    if (!role) throw new ForbiddenError('no project role on request');
    if (!hasRoleAtLeast(role, min)) {
      throw new ForbiddenError(`requires role ${min} or higher`);
    }
    await next();
    return;
  };

export type { Session, User };
