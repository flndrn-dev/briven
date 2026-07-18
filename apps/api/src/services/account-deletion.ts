import { and, eq, isNull, sql } from 'drizzle-orm';

import { brivenError, NotFoundError } from '@briven/shared';

import { getDb } from '../db/client.js';
import {
  apiKeys,
  orgInvitations,
  orgMembers,
  organizations,
  projectInvitations,
  projects,
  sessions,
  users,
  type Organization,
} from '../db/schema.js';
import { sendAccountDeletionConfirmation } from '../lib/email.js';
import { log } from '../lib/logger.js';
import { audit } from './audit.js';

/**
 * GDPR-compliant account deletion. Soft-delete with a 30-day reversal
 * window enforced by the `account-deletion-gc` worker. This service is
 * the only path that touches deletion state — no DB triggers.
 *
 * Steps, in one transaction:
 *   1. Send the "your account is being deleted" email BEFORE the
 *      mutations so the user has a paper trail at the original mailbox
 *      even if the address itself is the one they're closing.
 *   2. Revoke every session for this user (Better Auth invalidates on
 *      the next request).
 *   3. Revoke every pending project + org invitation the user sent.
 *   4. Revoke every api_key on any project owned by an org the user
 *      solely owns (multi-owner team org keys survive).
 *   5. Soft-delete every project under a sole-ownership personal/team
 *      org. Multi-owner team org projects survive — the user is just
 *      removed from membership.
 *   6. Soft-delete every personal org + every team org the user is the
 *      sole owner of.
 *   7. Remove the user's `orgMembers` rows everywhere else.
 *   8. Pseudonymise PII on the users row (legal name, address, VAT,
 *      company, display name, image). Keep id + email + createdAt so
 *      audit log FKs stay intact and an operator can correlate
 *      post-deletion incidents.
 *   9. Audit-log `account.deleted` with the cascade counts only —
 *      never the cleared values.
 *
 * Polar subscriptions are NOT auto-cancelled (the operator + user
 * manage that via the customer portal). The 30-day window gives them
 * room to cancel cleanly before any new invoice would generate.
 */

export interface AccountDeletionResult {
  userId: string;
  removedFromOrgs: number;
  soloOrgsDeleted: number;
  projectsDeleted: number;
  apiKeysRevoked: number;
  invitationsRevoked: number;
  sessionsRevoked: number;
}

export async function softDeleteAccount(args: {
  userId: string;
  reason?: string;
}): Promise<AccountDeletionResult> {
  const db = getDb();

  // Read the user first — locks in the row we're operating on + gives us
  // the original email for the confirmation send before we wipe the row.
  const [user] = await db.select().from(users).where(eq(users.id, args.userId)).limit(1);
  if (!user) throw new NotFoundError('user', args.userId);
  if (user.deletedAt) {
    throw new brivenError(
      'already_deleted',
      'this account is already in the deletion grace window',
      { status: 409 },
    );
  }

  // 1. Send confirmation email BEFORE mutations. If the send throws the
  // whole call aborts and nothing changes — better than half-deleting.
  // The send is suppression-aware via the existing email layer, so a
  // suppressed inbox just no-ops here.
  await sendAccountDeletionConfirmation(user.email);

  const counts = {
    userId: user.id,
    removedFromOrgs: 0,
    soloOrgsDeleted: 0,
    projectsDeleted: 0,
    apiKeysRevoked: 0,
    invitationsRevoked: 0,
    sessionsRevoked: 0,
  };

  // 2. Revoke sessions
  const sessionRows = await db
    .delete(sessions)
    .where(eq(sessions.userId, args.userId))
    .returning({ id: sessions.id });
  counts.sessionsRevoked = sessionRows.length;

  // 3. Revoke invitations sent by this user (project + org)
  const projInvRows = await db
    .update(projectInvitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(projectInvitations.invitedBy, args.userId),
        isNull(projectInvitations.acceptedAt),
        isNull(projectInvitations.revokedAt),
      ),
    )
    .returning({ id: projectInvitations.id });
  const orgInvRows = await db
    .update(orgInvitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(orgInvitations.invitedBy, args.userId),
        isNull(orgInvitations.acceptedAt),
        isNull(orgInvitations.revokedAt),
      ),
    )
    .returning({ id: orgInvitations.id });
  counts.invitationsRevoked = projInvRows.length + orgInvRows.length;

  // 4–7. Iterate every org the user is a member of. For sole-owner orgs,
  // cascade through (revoke keys → soft-delete projects → soft-delete
  // org). For shared orgs, just remove this user's orgMembers row.
  const memberships = await db
    .select({ orgId: orgMembers.orgId, role: orgMembers.role })
    .from(orgMembers)
    .where(eq(orgMembers.userId, args.userId));

  for (const m of memberships) {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, m.orgId))
      .limit(1);
    if (!org) continue;
    const sole = await isSoleOwner(org, args.userId);
    if (sole) {
      // 4. Revoke api_keys on this org's projects.
      const orgProjects = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.orgId, org.id), isNull(projects.deletedAt)));
      for (const p of orgProjects) {
        const revokedKeys = await db
          .update(apiKeys)
          .set({ revokedAt: new Date() })
          .where(and(eq(apiKeys.projectId, p.id), isNull(apiKeys.revokedAt)))
          .returning({ id: apiKeys.id });
        counts.apiKeysRevoked += revokedKeys.length;
      }

      // 5. Soft-delete the org's projects.
      const nowProjects = new Date();
      const deletedProjects = await db
        .update(projects)
        .set({ deletedAt: nowProjects, updatedAt: nowProjects })
        .where(and(eq(projects.orgId, org.id), isNull(projects.deletedAt)))
        .returning({ id: projects.id });
      counts.projectsDeleted += deletedProjects.length;

      // 6. Soft-delete the org itself.
      const nowOrg = new Date();
      await db
        .update(organizations)
        .set({ deletedAt: nowOrg, updatedAt: nowOrg })
        .where(eq(organizations.id, org.id));
      counts.soloOrgsDeleted += 1;
    } else {
      // 7. Shared team org — just remove this user from membership.
      await db
        .delete(orgMembers)
        .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.userId, args.userId)));
      counts.removedFromOrgs += 1;
    }
  }

  // 8. Pseudonymise PII + mark deleted. Email stays so the user can
  // re-sign-up later (same email = new fresh account; no merge).
  const now = new Date();
  await db
    .update(users)
    .set({
      legalName: null,
      companyName: null,
      vatId: null,
      vatVerifiedAt: null,
      addressLine1: null,
      addressLine2: null,
      addressCity: null,
      addressPostalCode: null,
      addressRegion: null,
      addressCountry: null,
      name: null,
      image: null,
      deletedAt: now,
      deletionReason: args.reason ?? null,
      updatedAt: now,
    })
    .where(eq(users.id, args.userId));

  // 9. Audit.
  await audit({
    actorId: args.userId,
    projectId: null,
    action: 'account.deleted',
    ipHash: null,
    userAgent: 'briven-api',
    metadata: {
      removedFromOrgs: counts.removedFromOrgs,
      soloOrgsDeleted: counts.soloOrgsDeleted,
      projectsDeleted: counts.projectsDeleted,
      apiKeysRevoked: counts.apiKeysRevoked,
      invitationsRevoked: counts.invitationsRevoked,
      sessionsRevoked: counts.sessionsRevoked,
      hasReason: Boolean(args.reason),
    },
  });

  log.info('account_soft_deleted', counts);
  return counts;
}

/**
 * True when the user is the only role='owner' member of the org, or
 * when the org is the user's personal org (always sole-owner by design).
 */
async function isSoleOwner(org: Organization, userId: string): Promise<boolean> {
  if (org.personal) return org.createdBy === userId;
  const db = getDb();
  const owners = await db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.role, 'owner')));
  if (owners.length === 0) return false;
  if (owners.length > 1) return false;
  return owners[0]?.userId === userId;
}

/**
 * Hard-delete every soft-deleted user whose 30-day grace window has
 * elapsed. Called by the account-deletion-gc worker.
 *
 * Order matters (migration 0042 / 0044):
 *   1. Hard-delete soft-deleted orgs solely owned by expired users.
 *      Ownership is taken from org_members (role='owner'), NOT
 *      organizations.created_by — that column is SET NULL on user
 *      delete, so a created_by-only predicate leaves zombie orgs that
 *      block the user DELETE forever.
 *   2. Hard-delete the expired users themselves. Remaining FKs cascade
 *      or SET NULL (sessions, accounts, audit_logs.actor_id, …).
 *
 * Returns the count of users hard-deleted. Idempotent: safe to retry
 * after a crash.
 */
export async function hardDeleteExpiredAccounts(opts: { graceDays?: number } = {}): Promise<number> {
  const db = getDb();
  const graceDays = opts.graceDays ?? 30;
  // Threshold comparison entirely in SQL (no JS-side date drift).
  const grace = sql`now() - (${graceDays} || ' days')::interval`;

  // 1. Soft-deleted orgs owned (sole owner role) by users past grace.
  await db.execute(sql`
    DELETE FROM organizations
    WHERE deleted_at IS NOT NULL
      AND id IN (
        SELECT m.org_id
        FROM org_members m
        WHERE m.role = 'owner'
          AND m.user_id IN (
            SELECT u.id
            FROM users u
            WHERE u.deleted_at IS NOT NULL
              AND u.deleted_at < ${grace}
          )
        GROUP BY m.org_id
        HAVING COUNT(*) = 1
      )
  `);

  // 2. Users past grace.
  const rows = (await db.execute(sql`
    DELETE FROM users
    WHERE deleted_at IS NOT NULL
      AND deleted_at < ${grace}
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  log.info('account_hard_delete_run', { graceDays, deleted: rows.length });
  return rows.length;
}
