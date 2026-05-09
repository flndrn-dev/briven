import { ForbiddenError, NotFoundError, ValidationError } from '@briven/shared';
import { and, eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { memberRole, projectMembers, projects, users, type MemberRole } from '../db/schema.js';

export interface MemberRow {
  userId: string;
  email: string;
  name: string | null;
  role: MemberRole;
  createdAt: Date;
}

export async function listMembers(projectId: string): Promise<MemberRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      userId: projectMembers.userId,
      email: users.email,
      name: users.name,
      role: projectMembers.role,
      createdAt: projectMembers.createdAt,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId));
  return rows;
}

export async function getMember(projectId: string, userId: string): Promise<MemberRow | null> {
  const db = getDb();
  const [row] = await db
    .select({
      userId: projectMembers.userId,
      email: users.email,
      name: users.name,
      role: projectMembers.role,
      createdAt: projectMembers.createdAt,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}

export interface AddMemberInput {
  projectId: string;
  email: string;
  role: MemberRole;
}

export async function addMemberByEmail(input: AddMemberInput): Promise<MemberRow> {
  if (!memberRole.includes(input.role)) {
    throw new ValidationError('invalid role', { role: input.role });
  }
  if (input.role === 'owner') {
    throw new ValidationError('owner role is reserved for the project creator');
  }

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (!user) {
    // Phase 3 will send an invite email here. For now, the user must already
    // exist in the control plane.
    throw new NotFoundError('user', input.email);
  }

  const existing = await getMember(input.projectId, user.id);
  if (existing) {
    throw new ValidationError('user is already a member of this project', {
      userId: user.id,
    });
  }

  await db.insert(projectMembers).values({
    projectId: input.projectId,
    userId: user.id,
    role: input.role,
  });

  const added = await getMember(input.projectId, user.id);
  if (!added) throw new Error('member insert returned no row');
  return added;
}

export async function updateMemberRole(
  projectId: string,
  userId: string,
  role: MemberRole,
): Promise<MemberRow> {
  if (!memberRole.includes(role)) {
    throw new ValidationError('invalid role', { role });
  }
  if (role === 'owner') {
    throw new ValidationError('owner role cannot be assigned; transfer ownership instead');
  }

  const existing = await getMember(projectId, userId);
  if (!existing) throw new NotFoundError('project_member', userId);
  if (existing.role === 'owner') {
    throw new ForbiddenError("cannot change the owner's role");
  }

  const db = getDb();
  await db
    .update(projectMembers)
    .set({ role, updatedAt: new Date() })
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));

  const updated = await getMember(projectId, userId);
  if (!updated) throw new Error('member update returned no row');
  return updated;
}

export async function removeMember(projectId: string, userId: string): Promise<void> {
  const existing = await getMember(projectId, userId);
  if (!existing) throw new NotFoundError('project_member', userId);
  if (existing.role === 'owner') {
    throw new ForbiddenError('cannot remove the owner; transfer ownership first');
  }
  const db = getDb();
  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
}

export async function findProjectBySlug(slug: string) {
  const db = getDb();
  const [row] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return row ?? null;
}
