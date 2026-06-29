import { NotFoundError, brivenError, newId } from '@briven/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  orgMembers,
  organizations,
  users,
  type OrgRole,
  type Organization,
  type ProjectTier,
} from '../db/schema.js';

/**
 * Tier → maximum number of orgs a user is allowed to OWN (not belong to).
 *
 *   Free: 1 — that's the auto-created personal org; no team creation.
 *   Pro:  unlimited — paying users can spin up as many team workspaces
 *         as they need. Matches industry norms (Vercel, GitHub, Netlify);
 *         Convex doesn't even surface a team count on their pricing page —
 *         their cap is per-developer-seat, not per-workspace.
 *   Team: unlimited.
 *
 * Independent of how many orgs they're INVITED to as a member — being
 * added to 10 other Team orgs doesn't burn your own cap.
 */
export const ORG_LIMIT_BY_TIER: Record<ProjectTier, number> = {
  free: 1,
  pro: Infinity,
  team: Infinity,
};

/**
 * True when `err` is (or wraps) a Postgres unique-violation (23505).
 * Drizzle nests the native pg error inside `.cause`, and its own wrapper
 * message is just "Failed query: insert into …" with no "duplicate key"
 * text — so we MUST check both levels. Missing the nested cause was the
 * exact bug that 500'd /v1/me during the account-deletion incident.
 */
export function isUniqueViolation(err: unknown): boolean {
  const top = err as { code?: string; message?: string } | null;
  const cause = (err as { cause?: { code?: string; message?: string } } | null)?.cause;
  const messages = [top?.message ?? '', cause?.message ?? ''];
  return (
    top?.code === '23505' ||
    cause?.code === '23505' ||
    messages.some((m) => m.includes('duplicate key') || m.includes('unique constraint'))
  );
}

/**
 * Resolve the caller's default organisation — today this is always their
 * `personal=true` org. Auto-created via the Better Auth `user.create.after`
 * hook in [lib/auth.ts](../lib/auth.ts) and self-healed here for users who
 * predate the hook (or whose hook firing failed).
 *
 * Throws NotFoundError only if the user themselves no longer exists.
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
  if (row) return row;

  // Lazy backfill: anyone created before the user-create hook landed
  // (everyone signed up between migration 0010 and the hook deploy)
  // hits this on their first /v1/me. Idempotent.
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new NotFoundError('user', userId);
  return ensurePersonalOrg({ userId: user.id, email: user.email, name: user.name });
}

/**
 * Idempotently produce the personal org for a user. Used both at signup
 * (Better Auth `user.create.after` hook) and as the lazy-create fallback
 * inside `getDefaultOrgForUser`. Safe to call concurrently — racing
 * inserts collapse to a re-read of the winner.
 */
export async function ensurePersonalOrg(input: {
  userId: string;
  email: string;
  name: string | null;
}): Promise<Organization> {
  const db = getDb();

  // Look up the personal org regardless of soft-delete state. A personal
  // org is the user's home base — if a prior account-deletion cascade
  // soft-deleted it, we must REVIVE that row, never insert a second one
  // (the id + slug are deterministic, so a second insert collides on the
  // PK / slug unique index → the /v1/me 500 from the deletion incident).
  const [existing] = await db
    .select()
    .from(organizations)
    .where(
      and(
        eq(organizations.createdBy, input.userId),
        eq(organizations.personal, true),
      ),
    )
    .limit(1);
  if (existing) {
    if (!existing.deletedAt) return existing;
    const [revived] = await db
      .update(organizations)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(organizations.id, existing.id))
      .returning();
    await db
      .insert(orgMembers)
      .values({ orgId: existing.id, userId: input.userId, role: 'owner' })
      .onConflictDoNothing();
    return revived ?? existing;
  }

  // Mirrors migration 0010 so personal orgs are addressable by user id alone.
  const orgId = `org_${input.userId}`;
  const baseSlug = slugFromEmail(input.email) || 'me';
  // Suffixed with a stable userId fragment so two users with the same email
  // local-part can both sign up. Slug is internal-only today (URLs stay
  // org-less until Phase 3); aesthetics matter less than uniqueness.
  const slug = `${baseSlug}-${input.userId.slice(-6).toLowerCase()}`;
  const displayName = (input.name?.trim() || baseSlug).slice(0, 200);

  try {
    const [row] = await db
      .insert(organizations)
      .values({
        id: orgId,
        slug,
        name: displayName,
        personal: true,
        createdBy: input.userId,
      })
      .returning();
    if (!row) {
      throw new brivenError('personal_org_create_failed', 'org insert returned no row', {
        status: 500,
      });
    }
    await db
      .insert(orgMembers)
      .values({ orgId: row.id, userId: input.userId, role: 'owner' })
      .onConflictDoNothing();
    return row;
  } catch (err) {
    // A racing insert (or a leftover soft-deleted row with the same
    // deterministic id/slug) collapses here — re-read the winner.
    if (isUniqueViolation(err)) {
      const [refound] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      if (refound) {
        await db
          .insert(orgMembers)
          .values({ orgId: refound.id, userId: input.userId, role: 'owner' })
          .onConflictDoNothing();
        // Self-heal: revive a soft-deleted row and/or fix a non-personal
        // flag so the next getDefaultOrgForUser hits the fast path instead
        // of re-entering ensurePersonalOrg (which would re-collide forever).
        if (refound.deletedAt || !refound.personal) {
          const [healed] = await db
            .update(organizations)
            .set({ deletedAt: null, personal: true, updatedAt: new Date() })
            .where(eq(organizations.id, refound.id))
            .returning();
          return healed ?? { ...refound, deletedAt: null, personal: true };
        }
        return refound;
      }
    }
    throw err;
  }
}

/**
 * Email local-part → kebab slug, stripped of edge dashes. Mirrors the
 * SQL `regexp_replace` in migration 0010. Pure function — extracted so
 * unit tests don't need a database.
 */
export function slugFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
/**
 * Rename a team org. Personal orgs are immutable (their name comes from
 * the user's profile) — rename is rejected. Returns the updated row,
 * or null when the org doesn't exist / isn't writable by the caller.
 */
export async function renameOrg(args: {
  orgId: string;
  userId: string;
  name: string;
}): Promise<Organization | null> {
  const db = getDb();
  const [target] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, args.orgId), isNull(organizations.deletedAt)))
    .limit(1);
  if (!target) return null;
  if (target.personal) return null; // can't rename a personal org via this path
  const member = await isOrgMember(args.userId, args.orgId);
  if (!member) return null;

  const [row] = await db
    .update(organizations)
    .set({ name: args.name, updatedAt: new Date() })
    .where(eq(organizations.id, args.orgId))
    .returning();
  return row ?? null;
}

export type PromoteResult =
  | { ok: true; org: Organization }
  | { ok: false; reason: string };

/**
 * Graduate a personal org to a real team. Personal orgs are the
 * single-member default Better Auth creates per user; promoting flips
 * `personal=false` so the rest of the dashboard's team affordances
 * (invite members, rename via the normal patch route, etc.) light up.
 *
 * Constraints:
 *   - org must exist and not be soft-deleted
 *   - org must currently be personal (already-team returns `already_team`,
 *     not an error — caller may have double-clicked through a slow form)
 *   - caller must be an owner of the org. Personal orgs only ever have
 *     one member (the creator at role=owner) so this is the natural
 *     gate — no path for a non-creator to graduate someone's personal
 *     space.
 */
export async function promotePersonalOrgToTeam(args: {
  orgId: string;
  userId: string;
  name: string;
}): Promise<PromoteResult> {
  const db = getDb();
  const [target] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, args.orgId), isNull(organizations.deletedAt)))
    .limit(1);
  if (!target) return { ok: false, reason: 'org_not_found' };
  if (!target.personal) return { ok: false, reason: 'already_team' };

  const [membership] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, args.orgId), eq(orgMembers.userId, args.userId)))
    .limit(1);
  if (!membership) return { ok: false, reason: 'not_a_member' };
  if (membership.role !== 'owner') return { ok: false, reason: 'owner_role_required' };

  const trimmedName = args.name.trim();
  if (trimmedName.length === 0) return { ok: false, reason: 'name_required' };

  const [row] = await db
    .update(organizations)
    .set({
      personal: false,
      name: trimmedName,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, args.orgId))
    .returning();
  if (!row) return { ok: false, reason: 'update_failed' };
  return { ok: true, org: row };
}

/**
 * Returns true when the user belongs to the given org. Used at project
 * creation to validate the orgId the dashboard sends actually belongs
 * to the caller — defends against an attacker scrolling through org
 * ids and dropping projects into other people's orgs.
 */
export async function isOrgMember(userId: string, orgId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, orgId)))
    .limit(1);
  return Boolean(row);
}

export interface OrgMemberRow {
  userId: string;
  email: string;
  name: string | null;
  role: OrgRole;
  joinedAt: Date;
}

/**
 * List every member of an org with their profile basics. Used by the
 * team-detail page to render the members section above pending invites.
 * Caller is expected to have already checked membership.
 */
export async function listOrgMembers(orgId: string): Promise<OrgMemberRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      userId: orgMembers.userId,
      email: users.email,
      name: users.name,
      role: orgMembers.role,
      joinedAt: orgMembers.createdAt,
    })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(eq(orgMembers.orgId, orgId));
  // Owner first, then alphabetical by email. Matches what GitHub / Vercel do.
  const roleRank: Record<OrgRole, number> = { owner: 0, admin: 1, developer: 2, viewer: 3 };
  return rows.sort((a, b) => {
    if (a.role !== b.role) return roleRank[a.role] - roleRank[b.role];
    return a.email.localeCompare(b.email);
  });
}

/**
 * Soft-delete a team org. Refuses on personal orgs and on team orgs that
 * still own non-deleted projects — those would otherwise be orphaned. The
 * caller is told to delete (or move) the projects first.
 */
export async function deleteOrg(args: {
  orgId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const db = getDb();
  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, args.orgId), isNull(organizations.deletedAt)))
    .limit(1);
  if (!org) return { ok: false, reason: 'org not found' };
  if (org.personal) return { ok: false, reason: 'cannot delete a personal org' };

  const member = await isOrgMember(args.userId, args.orgId);
  if (!member) return { ok: false, reason: 'not a member of this org' };

  // Only owners can delete a team org.
  const [memberRow] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, args.userId), eq(orgMembers.orgId, args.orgId)))
    .limit(1);
  if (memberRow?.role !== 'owner') {
    return { ok: false, reason: 'only an owner can delete a team' };
  }

  // Bounce if there are live projects in the org. The dashboard surfaces
  // this with a friendly "delete or move projects first" message.
  const liveProjects = await db.execute(sql`
    select 1 from projects
    where org_id = ${args.orgId}
      and deleted_at is null
    limit 1
  `);
  if (liveProjects.length > 0) {
    return { ok: false, reason: 'team still has projects — delete or move them first' };
  }

  await db
    .update(organizations)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(organizations.id, args.orgId));
  return { ok: true };
}

/**
 * Change a member's role inside an org. Same last-owner protection as
 * removeOrgMember: if the only owner is being demoted, the request is
 * rejected and the caller is told to promote another member first.
 */
export async function changeOrgMemberRole(args: {
  orgId: string;
  userId: string;
  newRole: OrgRole;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const db = getDb();
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, args.orgId))
    .limit(1);
  if (!org) return { ok: false, reason: 'org not found' };
  if (org.personal) return { ok: false, reason: 'cannot change roles in a personal org' };

  const [target] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, args.orgId), eq(orgMembers.userId, args.userId)))
    .limit(1);
  if (!target) return { ok: false, reason: 'user is not a member of this org' };
  if (target.role === args.newRole) return { ok: true };

  if (target.role === 'owner' && args.newRole !== 'owner') {
    const owners = await db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, args.orgId), eq(orgMembers.role, 'owner')));
    if (owners.length <= 1) {
      return { ok: false, reason: 'cannot demote the last owner — promote another member first' };
    }
  }

  await db
    .update(orgMembers)
    .set({ role: args.newRole })
    .where(and(eq(orgMembers.orgId, args.orgId), eq(orgMembers.userId, args.userId)));
  return { ok: true };
}

/**
 * Remove a member from an org. Refuses to remove the last owner — every
 * team must always have at least one owner so billing/admin actions remain
 * possible. Personal orgs reject removal entirely.
 */
export async function removeOrgMember(args: {
  orgId: string;
  userId: string;
}): Promise<{ removed: true } | { removed: false; reason: string }> {
  const db = getDb();
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, args.orgId))
    .limit(1);
  if (!org) return { removed: false, reason: 'org not found' };
  if (org.personal) return { removed: false, reason: 'cannot remove members from a personal org' };

  const [target] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, args.orgId), eq(orgMembers.userId, args.userId)))
    .limit(1);
  if (!target) return { removed: false, reason: 'user is not a member of this org' };

  if (target.role === 'owner') {
    const owners = await db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, args.orgId), eq(orgMembers.role, 'owner')));
    if (owners.length <= 1) {
      return { removed: false, reason: 'cannot remove the last owner — promote another member first' };
    }
  }

  await db
    .delete(orgMembers)
    .where(and(eq(orgMembers.orgId, args.orgId), eq(orgMembers.userId, args.userId)));
  return { removed: true };
}

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
