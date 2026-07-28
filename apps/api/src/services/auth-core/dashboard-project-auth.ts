/**
 * Project-scoped Auth dashboard access.
 *
 * Platform session alone is not enough for user list / GDPR export /
 * session revoke / roles / migration — must be admin of the target project.
 */

import type { Context } from 'hono';

import { hasRoleAtLeast } from '../access.js';
import { getProjectAccessForUser } from '../projects.js';
import type { User } from '../../lib/auth.js';

export async function requireDashboardProjectAdmin(
  c: Context,
  projectId: string | null | undefined,
): Promise<{ projectId: string } | Response> {
  const user = c.get('user') as User | null;
  if (!user) {
    return c.json(
      {
        engine: 'briven-engine',
        code: 'unauthorized',
        message: 'authentication required',
      },
      401,
    );
  }
  const id = projectId?.trim() ?? '';
  if (!id.startsWith('p_')) {
    return c.json(
      {
        engine: 'briven-engine',
        code: 'project_id_required',
        message:
          'projectId query/body is required (Auth admin is project-scoped)',
      },
      400,
    );
  }
  try {
    const access = await getProjectAccessForUser(id, user.id);
    if (!hasRoleAtLeast(access.role, 'admin')) {
      return c.json(
        {
          engine: 'briven-engine',
          code: 'forbidden',
          message: 'project admin role required',
        },
        403,
      );
    }
  } catch {
    return c.json(
      {
        engine: 'briven-engine',
        code: 'forbidden',
        message: 'no access to this project',
      },
      403,
    );
  }
  return { projectId: id };
}
