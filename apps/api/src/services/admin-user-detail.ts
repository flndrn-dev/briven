import { NotFoundError } from '@briven/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { auditLogs, orgMembers, organizations, projects, sessions, users } from '../db/schema.js';
import { lookupIp } from '../lib/geoip.js';
import { listStorageUsage } from './storage-admin.js';

/**
 * DEEP per-user admin detail. CONTRACT with apps/web/(admin)/admin/users/[id].
 * Enriches the basic user record with: full profile + company block, the
 * geo-resolved last sign-in (raw IP never surfaced — only a nearBy city/region/
 * country from the GeoIP lookup), every project the user's orgs own (with REAL
 * storage rows/tables + effective limits), totals, and the newest 50 audit
 * rows where they were the actor. Real numbers or null — never fabricated.
 */
export interface AdminUserDeepDetail {
  user: {
    id: string;
    email: string;
    name: string | null;
    legalName: string | null;
    isAdmin: boolean;
    emailVerified: boolean;
    suspendedAt: Date | null;
    createdAt: Date;
    timezone: string | null;
    dateOfBirth: string | null;
    countryOfBirth: string | null;
    company: { name: string | null; vatId: string | null; country: string | null };
    lastSignIn: {
      at: Date;
      ipAddress: string | null;
      userAgent: string | null;
      nearBy: { city: string | null; region: string | null; country: string | null } | null;
    } | null;
  };
  projects: Array<{
    id: string;
    name: string;
    slug: string;
    tier: string;
    region: string;
    createdAt: Date;
    rows: number | null;
    tables: number | null;
    rowLimit: number;
    tableLimit: number;
  }>;
  totals: { projectCount: number; totalRows: number; totalTables: number };
  activity: Array<{ at: string; action: string; detail: string | null }>;
}

/** Collapse an audit metadata blob into a short human detail string, or null. */
function auditDetail(metadata: unknown): string | null {
  if (metadata == null || typeof metadata !== 'object') return null;
  const entries = Object.entries(metadata as Record<string, unknown>);
  if (entries.length === 0) return null;
  return entries
    .slice(0, 4)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ');
}

export async function getUserDeepDetailForAdmin(userId: string): Promise<AdminUserDeepDetail> {
  const db = getDb();

  const [userRow] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      legalName: users.legalName,
      isAdmin: users.isAdmin,
      emailVerified: users.emailVerified,
      suspendedAt: users.suspendedAt,
      createdAt: users.createdAt,
      timezone: users.timezone,
      dateOfBirth: users.dateOfBirth,
      countryOfBirth: users.countryOfBirth,
      companyName: users.companyName,
      vatId: users.vatId,
      addressCountry: users.addressCountry,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!userRow) throw new NotFoundError('user', userId);

  const [orgRows, auditRows, lastSession] = await Promise.all([
    db
      .select({ id: organizations.id })
      .from(orgMembers)
      .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
      .where(and(eq(orgMembers.userId, userId), isNull(organizations.deletedAt))),
    db
      .select({
        action: auditLogs.action,
        createdAt: auditLogs.createdAt,
        metadata: auditLogs.metadata,
      })
      .from(auditLogs)
      .where(eq(auditLogs.actorId, userId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(50),
    db
      .select({
        createdAt: sessions.createdAt,
        ipAddress: sessions.ipAddress,
        userAgent: sessions.userAgent,
      })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt))
      .limit(1),
  ]);

  const orgIds = orgRows.map((o) => o.id);
  const projectRows =
    orgIds.length === 0
      ? []
      : await db
          .select({
            id: projects.id,
            slug: projects.slug,
            name: projects.name,
            tier: projects.tier,
            region: projects.region,
            createdAt: projects.createdAt,
          })
          .from(projects)
          .where(and(inArray(projects.orgId, orgIds), isNull(projects.deletedAt)))
          .orderBy(desc(projects.createdAt));

  // Real per-project storage from the SAME source the /v1/admin/storage route
  // uses. listStorageUsage returns every live project; index it by id so each
  // of this user's projects gets its actual rows/tables + effective limits.
  const projectIds = new Set(projectRows.map((p) => p.id));
  const usageById = new Map(
    projectIds.size === 0
      ? []
      : (await listStorageUsage())
          .filter((u) => projectIds.has(u.id))
          .map((u) => [u.id, u] as const),
  );

  let totalRows = 0;
  let totalTables = 0;
  const projectsOut = projectRows.map((p) => {
    const usage = usageById.get(p.id);
    const rows = usage ? usage.rowCount : null;
    const tables = usage ? usage.tableCount : null;
    if (rows != null) totalRows += rows;
    if (tables != null) totalTables += tables;
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      tier: p.tier,
      region: p.region,
      createdAt: p.createdAt,
      rows,
      tables,
      rowLimit: usage ? usage.maxRows : 0,
      tableLimit: usage ? usage.maxTables : 0,
    };
  });

  const nearBy = lastSession[0] ? await lookupIp(lastSession[0].ipAddress) : null;

  return {
    user: {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      legalName: userRow.legalName,
      isAdmin: userRow.isAdmin,
      emailVerified: userRow.emailVerified,
      suspendedAt: userRow.suspendedAt,
      createdAt: userRow.createdAt,
      timezone: userRow.timezone,
      dateOfBirth: userRow.dateOfBirth,
      countryOfBirth: userRow.countryOfBirth,
      company: {
        name: userRow.companyName,
        vatId: userRow.vatId,
        country: userRow.addressCountry,
      },
      lastSignIn: lastSession[0]
        ? {
            at: lastSession[0].createdAt,
            ipAddress: lastSession[0].ipAddress,
            userAgent: lastSession[0].userAgent,
            nearBy,
          }
        : null,
    },
    projects: projectsOut,
    totals: { projectCount: projectsOut.length, totalRows, totalTables },
    activity: auditRows.map((r) => ({
      at: r.createdAt.toISOString(),
      action: r.action,
      detail: auditDetail(r.metadata),
    })),
  };
}
