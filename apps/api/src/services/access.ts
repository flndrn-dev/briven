import { ForbiddenError, NotFoundError } from '@briven/shared';
import { and, eq, isNull } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  orgMembers,
  projectMembers,
  projects,
  type MemberRole,
  type Project,
} from '../db/schema.js';

/**
 * Single rank table for both `OrgRole` and `MemberRole` — they share an
 * identical enum `(['owner', 'admin', 'developer', 'viewer'])` so one rank
 * map suffices.
 */
export const ROLE_RANK: Record<MemberRole, number> = {
  viewer: 0,
  developer: 1,
  admin: 2,
  owner: 3,
};

/**
 * Compute the effective role a user has on a project given their org-level
 * membership and (optional) project-level override. Pure — no DB access.
 *
 * Model B (org-as-baseline + project-overrides):
 *   effective = max(org_role, project_role)
 *
 * Either side may be null. If both are null the user has no access.
 * A project membership row therefore both grants visibility (if no org
 * row exists) and can elevate the role (if a lower org role exists).
 */
export function effectiveRole(
  orgRole: MemberRole | null,
  projectRole: MemberRole | null,
): MemberRole | null {
  if (!orgRole && !projectRole) return null;
  if (!orgRole) return projectRole;
  if (!projectRole) return orgRole;
  return ROLE_RANK[orgRole] >= ROLE_RANK[projectRole] ? orgRole : projectRole;
}

export function hasRoleAtLeast(role: MemberRole, min: MemberRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export interface ProjectAccess {
  project: Project;
  role: MemberRole;
}

/**
 * Resolve a user's effective access to a project. Returns null if the user
 * has neither an `orgMembers` row for the project's org nor a
 * `projectMembers` row for the project. Otherwise returns the project plus
 * the higher-rank of the two roles.
 *
 * Soft-deleted projects (`deletedAt IS NOT NULL`) resolve as null so
 * existing 404 semantics are preserved.
 */
export async function resolveProjectAccess(
  projectId: string,
  userId: string,
): Promise<ProjectAccess | null> {
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (!project) return null;

  const [orgRow] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, project.orgId), eq(orgMembers.userId, userId)))
    .limit(1);

  const [projRow] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);

  const role = effectiveRole(orgRow?.role ?? null, projRow?.role ?? null);
  if (!role) return null;
  return { project, role };
}

/**
 * Verify a session-authenticated user has at least `min` role on the
 * project. Throws `NotFoundError` if they have no access at all (so we
 * don't leak project existence to non-members) or `ForbiddenError` if
 * their effective role is below the minimum. Returns the resolved
 * `ProjectAccess` so callers can reuse the project row without a second
 * fetch.
 */
export async function assertProjectRole(
  projectId: string,
  userId: string,
  min: MemberRole,
): Promise<ProjectAccess> {
  const access = await resolveProjectAccess(projectId, userId);
  if (!access) throw new NotFoundError('project', projectId);
  if (!hasRoleAtLeast(access.role, min)) {
    throw new ForbiddenError(`requires role ${min} or higher`);
  }
  return access;
}
