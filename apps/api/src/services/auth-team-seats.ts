/**
 * Auth dashboard team seats (Phase 6.1).
 *
 * Project owners can invite team members to manage auth settings without
 * granting full project admin access. Auth team members receive `admin` or
 * `viewer` roles that are checked by `requireAuthTeamAdmin` middleware on
 * auth-service routes.
 */

import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { projectAuthTeamMembers, users, authTeamRole, type AuthTeamRole } from '../db/schema.js';
import { NotFoundError, ValidationError } from '@briven/shared';

export interface AuthTeamMember {
  projectId: string;
  userId: string;
  role: AuthTeamRole;
  email: string;
  name: string | null;
  invitedBy: string | null;
  createdAt: Date;
}

export async function listAuthTeamMembers(projectId: string): Promise<AuthTeamMember[]> {
  const db = getDb();
  const rows = await db
    .select({
      projectId: projectAuthTeamMembers.projectId,
      userId: projectAuthTeamMembers.userId,
      role: projectAuthTeamMembers.role,
      email: users.email,
      name: users.name,
      invitedBy: projectAuthTeamMembers.invitedBy,
      createdAt: projectAuthTeamMembers.createdAt,
    })
    .from(projectAuthTeamMembers)
    .innerJoin(users, eq(users.id, projectAuthTeamMembers.userId))
    .where(eq(projectAuthTeamMembers.projectId, projectId))
    .orderBy(projectAuthTeamMembers.createdAt);

  return rows.map((r) => ({
    projectId: r.projectId,
    userId: r.userId,
    role: r.role as AuthTeamRole,
    email: r.email,
    name: r.name,
    invitedBy: r.invitedBy,
    createdAt: r.createdAt,
  }));
}

export async function getAuthTeamRole(
  projectId: string,
  userId: string,
): Promise<AuthTeamRole | null> {
  const db = getDb();
  const [row] = await db
    .select({ role: projectAuthTeamMembers.role })
    .from(projectAuthTeamMembers)
    .where(
      and(
        eq(projectAuthTeamMembers.projectId, projectId),
        eq(projectAuthTeamMembers.userId, userId),
      ),
    )
    .limit(1);
  return (row?.role as AuthTeamRole) ?? null;
}

export async function addAuthTeamMember(input: {
  projectId: string;
  userId: string;
  role: AuthTeamRole;
  invitedBy: string;
}): Promise<{ projectId: string; userId: string; role: AuthTeamRole }> {
  if (!authTeamRole.includes(input.role)) {
    throw new ValidationError('role must be admin or viewer', { role: input.role });
  }
  const db = getDb();
  await db
    .insert(projectAuthTeamMembers)
    .values({
      projectId: input.projectId,
      userId: input.userId,
      role: input.role,
      invitedBy: input.invitedBy,
    })
    .onConflictDoNothing({
      target: [projectAuthTeamMembers.projectId, projectAuthTeamMembers.userId],
    });
  return { projectId: input.projectId, userId: input.userId, role: input.role };
}

export async function removeAuthTeamMember(
  projectId: string,
  userId: string,
): Promise<void> {
  const db = getDb();
  const result = await db
    .delete(projectAuthTeamMembers)
    .where(
      and(
        eq(projectAuthTeamMembers.projectId, projectId),
        eq(projectAuthTeamMembers.userId, userId),
      ),
    )
    .returning({ projectId: projectAuthTeamMembers.projectId });
  if (!result[0]) {
    throw new NotFoundError('auth_team_member', `${projectId}:${userId}`);
  }
}

export async function findUserByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const db = getDb();
  const [row] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return row ?? null;
}
