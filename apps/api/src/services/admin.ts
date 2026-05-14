import { NotFoundError } from '@briven/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { auditLogs, orgMembers, organizations, projects, sessions, users } from '../db/schema.js';

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

export interface AdminUserDetail {
  user: AdminUserRow;
  orgs: Array<{ id: string; name: string; slug: string; personal: boolean; role: string }>;
  projects: Array<{ id: string; slug: string; name: string; tier: string; orgId: string; createdAt: Date }>;
  recentAudit: Array<{ id: string; action: string; createdAt: Date; metadata: Record<string, unknown> | null }>;
}

/**
 * Drilldown for the admin user-detail page. Loads basics + every org
 * the user is a member of + every project owned by those orgs + the
 * last 50 audit rows where they're the actor. Single fan-out, parallel
 * queries — at Phase 3 scale this is one round-trip burst.
 */
export async function getUserDetailForAdmin(userId: string): Promise<AdminUserDetail> {
  const db = getDb();
  const [userRow] = await db
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
        WHERE m.user_id = ${users.id} AND p.deleted_at IS NULL
      )`,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!userRow) throw new NotFoundError('user', userId);

  const [orgRows, auditRows] = await Promise.all([
    db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        personal: organizations.personal,
        role: orgMembers.role,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
      .where(and(eq(orgMembers.userId, userId), isNull(organizations.deletedAt))),
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        createdAt: auditLogs.createdAt,
        metadata: auditLogs.metadata,
      })
      .from(auditLogs)
      .where(eq(auditLogs.actorId, userId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(50),
  ]);

  const orgIds = orgRows.map((o) => o.id);
  const projectRows = orgIds.length === 0
    ? []
    : await db
        .select({
          id: projects.id,
          slug: projects.slug,
          name: projects.name,
          tier: projects.tier,
          orgId: projects.orgId,
          createdAt: projects.createdAt,
        })
        .from(projects)
        .where(and(inArray(projects.orgId, orgIds), isNull(projects.deletedAt)))
        .orderBy(desc(projects.createdAt));

  return {
    user: userRow,
    orgs: orgRows,
    projects: projectRows,
    // jsonb columns surface as `unknown` from drizzle; the consumer
    // (admin user-detail page) renders metadata.action only, so cast
    // to the documented Record<string, unknown> | null shape here.
    recentAudit: auditRows.map((r) => ({
      ...r,
      metadata: r.metadata as Record<string, unknown> | null,
    })),
  };
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
  const [d] = await db.execute<{ c: number }>(sql`SELECT count(*)::int AS c FROM deployments`);
  return { users: u?.c ?? 0, projects: p?.c ?? 0, deployments: d?.c ?? 0 };
}
