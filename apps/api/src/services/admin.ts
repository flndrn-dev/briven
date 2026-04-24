import { NotFoundError } from '@briven/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { projects, sessions, users } from '../db/schema.js';

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  isAdmin: boolean;
  suspendedAt: Date | null;
  createdAt: Date;
  projectCount: number;
}

export async function listUsers(limit = 200): Promise<AdminUserRow[]> {
  const db = getDb();
  // One query with a correlated subselect for project count — acceptable at
  // Phase 3 scale (< few thousand users).
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      emailVerified: users.emailVerified,
      isAdmin: users.isAdmin,
      suspendedAt: users.suspendedAt,
      createdAt: users.createdAt,
      projectCount: sql<number>`(
        SELECT count(*)::int FROM projects p
        INNER JOIN org_members m ON m.org_id = p.org_id
        WHERE m.user_id = users.id AND p.deleted_at IS NULL
      )`,
    })
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(desc(users.createdAt))
    .limit(limit);
  return rows;
}

export interface AdminProjectRow {
  id: string;
  slug: string;
  name: string;
  orgId: string;
  tier: string;
  createdAt: Date;
}

export async function listProjects(limit = 500): Promise<AdminProjectRow[]> {
  const db = getDb();
  return db
    .select({
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      orgId: projects.orgId,
      tier: projects.tier,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(isNull(projects.deletedAt))
    .orderBy(desc(projects.createdAt))
    .limit(limit);
}

export async function suspendUser(userId: string): Promise<void> {
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new NotFoundError('user', userId);
  await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, userId));
  // Invalidate every live session for the suspended user.
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function unsuspendUser(userId: string): Promise<void> {
  const db = getDb();
  await db.update(users).set({ suspendedAt: null }).where(eq(users.id, userId));
}

/**
 * Signs out every session for a user immediately — does NOT flip the
 * suspended flag. Used when rotating a compromised session.
 */
export async function forceSignOut(userId: string): Promise<number> {
  const db = getDb();
  const result = await db
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ id: sessions.id });
  return result.length;
}

export async function grantAdmin(userId: string): Promise<void> {
  const db = getDb();
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, userId));
}

export async function revokeAdmin(userId: string): Promise<void> {
  const db = getDb();
  await db.update(users).set({ isAdmin: false }).where(eq(users.id, userId));
}

export async function adminStats(): Promise<{
  users: number;
  projects: number;
  deployments: number;
}> {
  const db = getDb();
  const [u] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(users)
    .where(isNull(users.deletedAt));
  const [p] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(projects)
    .where(and(isNull(projects.deletedAt)));
  // deployments table doesn't have a soft-delete; sum all
  const [d] = await db.execute<{ c: number }>(
    sql`SELECT count(*)::int AS c FROM deployments`,
  );
  return { users: u?.c ?? 0, projects: p?.c ?? 0, deployments: d?.c ?? 0 };
}
