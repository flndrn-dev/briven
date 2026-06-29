import { ForbiddenError, UnauthorizedError } from '@briven/shared';
import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';

import { getDb } from '../db/client.js';
import { users as usersTable } from '../db/schema.js';
import { verifyCliToken } from '../lib/cli-jwt.js';
import { log } from '../lib/logger.js';
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
 *   2. An `Authorization: Bearer brk_...` header whose key matches `:id`, OR
 *   3. An `Authorization: Bearer <jwt>` minted by `/v1/auth/cli-token`
 *      (scope=cli), resolved against the same project-access lookup as the
 *      cookie/session branch — so the CLI wizard and dashboard see the same
 *      effective role on the same project.
 *
 * On success this middleware populates:
 *   - `c.var.apiKeyId` — non-null when authed via API key, null for session
 *   - `c.var.projectRole` — the effective `MemberRole`. For session auth this
 *     is `max(orgRole, projectRole)`. For api-key auth it is the role the key
 *     was minted at (defaults to 'admin' for back-compat with keys created
 *     before per-key role scoping landed; new keys may be issued at any of
 *     viewer / developer / admin).
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
  if (!token) {
    throw new UnauthorizedError();
  }

  // CLI JWT branch — accept scope=cli tokens minted by /v1/auth/cli-token.
  // The token's `sub` identifies the user; we then resolve project access
  // the same way the cookie/session branch does (getProjectAccessForUser),
  // so both paths populate `projectRole` identically.
  if (!token.startsWith('brk_')) {
    let userRow: User | null = null;
    try {
      const payload = await verifyCliToken(token);
      const [row] = await getDb()
        .select({
          id: usersTable.id,
          email: usersTable.email,
          name: usersTable.name,
          deletedAt: usersTable.deletedAt,
          suspendedAt: usersTable.suspendedAt,
        })
        .from(usersTable)
        .where(eq(usersTable.id, payload.sub))
        .limit(1);
      if (!row) {
        return c.json({ code: 'unauthorized', message: 'cli token user not found' }, 401);
      }
      // Self-contained status check — don't rely on a downstream requireAuth
      // re-validating. A suspended/soft-deleted user must not pass here.
      if (row.deletedAt || row.suspendedAt) {
        return c.json({ code: 'unauthorized', message: 'account is no longer active' }, 401);
      }
      userRow = { id: row.id, email: row.email, name: row.name } as unknown as User;
    } catch (err) {
      log.warn('project_auth_cli_jwt_rejected', {
        err: err instanceof Error ? err.message : String(err),
      });
      return c.json({ code: 'unauthorized', message: 'invalid cli token' }, 401);
    }
    c.set('user', userRow);
    const access = await getProjectAccessForUser(projectId, userRow.id);
    c.set('apiKeyId', null);
    c.set('projectRole', access.role);
    await next();
    return;
  }

  const resolved = await resolveApiKey(token);
  if (!resolved) throw new UnauthorizedError('invalid or revoked api key');
  if (resolved.projectId !== projectId) {
    throw new ForbiddenError('api key does not belong to this project');
  }

  c.set('apiKeyId', resolved.keyId);
  c.set('projectRole', resolved.role);
  await next();
  return;
};

/**
 * Gate a route on a minimum `MemberRole`. Must follow `requireProjectAuth`
 * in the chain (which populates `projectRole`). API-key authenticated
 * requests carry the role they were minted at (default 'admin') — routes
 * that need to refuse api keys outright should add an explicit check on
 * `c.get('apiKeyId')`.
 *
 * Owner-tier gating: no route uses `requireProjectRole('owner')` today,
 * but the scaffolding works end-to-end. To add a future owner-only route
 * (e.g. project hard-delete or ownership transfer):
 *
 *   projectsRouter.delete(
 *     '/v1/projects/:id/permanent',
 *     requireAuth(),
 *     requireProjectRole('owner'),
 *     async (c) => { ... },
 *   );
 *
 * Because `routes/api-keys.ts` and `services/api-keys.ts:isAssignableKeyRole`
 * both reject 'owner' as an assignable key role, no api key can satisfy
 * such a gate — owner-tier routes are session-only by construction.
 * Rank semantics are pinned by `services/access.test.ts` ("owner-tier
 * gating" suite).
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
