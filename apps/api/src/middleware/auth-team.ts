import type { MiddlewareHandler } from 'hono';
import { ForbiddenError } from '@briven/shared';
import { hasRoleAtLeast } from '../services/access.js';
import { getAuthTeamRole } from '../services/auth-team-seats.js';
import type { MemberRole } from '../db/schema.js';
import type { Session, User } from './session.js';

/**
 * Auth-team access gate for `/v1/projects/:id/auth/*` routes.
 *
 * Must run AFTER `requireProjectAuth()` (which populates `projectRole`).
 * If the user already has project-level admin/owner access, pass through.
 * Otherwise, check the `project_auth_team_members` table — an auth team
 * admin is treated as project admin for the remainder of the request.
 *
 * Viewer-tier auth team members are NOT elevated by this middleware;
 * routes that want to allow viewers should skip this gate.
 */
export const requireAuthTeamAdmin = (): MiddlewareHandler => async (c, next) => {
  const role = c.get('projectRole') as MemberRole | null | undefined;
  if (role && hasRoleAtLeast(role, 'admin')) {
    return next();
  }

  const user = c.get('user') as User | null;
  const projectId = c.req.param('id');
  if (user && projectId) {
    const teamRole = await getAuthTeamRole(projectId, user.id);
    if (teamRole === 'admin') {
      // Elevate the request context so downstream `requireProjectRole('admin')`
      // sees an effective admin role.
      c.set('projectRole', 'admin');
      return next();
    }
  }

  throw new ForbiddenError('requires auth team admin access');
};

export type { Session, User };
