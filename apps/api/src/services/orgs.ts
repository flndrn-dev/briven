import { NotFoundError, brivenError, newId } from '@briven/shared';
import { and, eq, isNull } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  orgMembers,
  organizations,
  type OrgRole,
  type Organization,
  type ProjectTier,
} from '../db/schema.js';

/**
 * Tier → maximum number of orgs a user is allowed to OWN (not belong to).
 * 'Infinity' for Team so the check is a simple `<`. Read by
 * `canUserCreateAnotherOrg`, enforced at the future create-org endpoint
 * (no UI this project — Phase 3).
 */
export const ORG_LIMIT_BY_TIER: Record<ProjectTier, number> = {
  free: 1,
  pro: 3,
  team: Infinity,
};

/**
 * Resolve the caller's default organisation — today this is always their
 * `personal=true` org, auto-created by migration 0010 on every signup.
 * Throws NotFoundError if the row is missing (shouldn't happen post-migration;
 * a user without an org is a data-integrity bug).
 */
export async function getDefaultOrgForUser(userId: string): Promise<Organization> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(organizations)
    .where(
      and(
        eq(organizations.createdBy, userId),
        eq(organizations.personal, true),
        isNull(organizations.deletedAt),
      ),
    )
    .limit(1);
  if (!row) {
    throw new NotFoundError('personal org', userId);
  }
  return row;
}

/**
 * All orgs a user is a member of (personal first). Used by the future
 * org-switcher UI; today only the billing/project routes that want a list.
 */
export async function listOrgsForUser(userId: string): Promise<Organization[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      personal: organizations.personal,
      createdBy: organizations.createdBy,
      createdAt: organizations.createdAt,
      updatedAt: organizations.updatedAt,
      deletedAt: organizations.deletedAt,
    })
    .from(organizations)
    .innerJoin(orgMembers, eq(orgMembers.orgId, organizations.id))
    .where(and(eq(orgMembers.userId, userId), isNull(organizations.deletedAt)));
  // Personal org sorted first; rest alphabetical by name.
  return rows.sort((a, b) => {
    if (a.personal !== b.personal) return a.personal ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Membership guard — every org-scoped route calls this before reading data
 * under an orgId it didn't choose itself. Returns false rather than
 * throwing so callers can decide the HTTP status (403 vs 404).
 */
export async function isMember(orgId: string, userId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  return Boolean(row);
}

/**
 * Whether this user may create another org on their current tier. Counts
 * orgs they CREATED, not orgs they're a member of — being invited to 10
 * other Team orgs still leaves a Free user able to create their 1 personal.
 *
 * Not wired to a route this project (no create-org UI yet). Exists with a
 * unit-tested rule so Phase 3 only needs to plug it in.
 */
export async function canUserCreateAnotherOrg(
  userId: string,
  tier: ProjectTier,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const db = getDb();
  const rows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.createdBy, userId), isNull(organizations.deletedAt)));
  const limit = ORG_LIMIT_BY_TIER[tier];
  if (rows.length >= limit) {
    return {
      allowed: false,
      reason: `tier ${tier} allows at most ${limit} owned organisation${limit === 1 ? '' : 's'}`,
    };
  }
  return { allowed: true };
}

export interface CreateOrgInput {
  createdBy: string;
  name: string;
  slug: string;
  personal?: boolean;
  role?: OrgRole;
}

/**
 * Create a new org + make the creator its owner. Not wired to any route
 * this project; exposed for future invite/create-org flows.
 */
export async function createOrg(input: CreateOrgInput): Promise<Organization> {
  const db = getDb();
  const id = newId('org');
  const [row] = await db
    .insert(organizations)
    .values({
      id,
      slug: input.slug,
      name: input.name,
      personal: input.personal ?? false,
      createdBy: input.createdBy,
    })
    .returning();
  if (!row) {
    throw new brivenError('org_insert_failed', 'org insert returned no row', { status: 500 });
  }
  await db.insert(orgMembers).values({
    orgId: row.id,
    userId: input.createdBy,
    role: input.role ?? 'owner',
  });
  return row;
}
