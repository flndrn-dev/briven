import { createHash, randomBytes } from 'node:crypto';

import { newId, NotFoundError, ValidationError } from '@briven/shared';
import { and, eq, isNull } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  orgInvitations,
  orgMembers,
  orgRole,
  organizations,
  type OrgInvitation,
  type OrgRole,
} from '../db/schema.js';
import { sendInvitation } from '../lib/email.js';

/**
 * Org-level invitations. Mirrors services/invitations.ts (project-level)
 * but scoped to an orgId + carrying an OrgRole. Acceptance creates
 * the orgMembers row + marks accepted_at on the invitation.
 *
 * Token shape: 32 bytes random → base64url plaintext sent in email,
 * sha256 hash stored in db. Same pattern as project invitations so an
 * operator reading the db can't impersonate.
 */

const EXPIRES_MS = 7 * 24 * 60 * 60 * 1000;

export interface OrgInviteInput {
  orgId: string;
  email: string;
  role: OrgRole;
  invitedBy: string;
  callbackURL: string;
}

export async function createOrgInvitation(input: OrgInviteInput): Promise<OrgInvitation> {
  if (!orgRole.includes(input.role)) {
    throw new ValidationError('invalid role', { role: input.role });
  }
  if (input.role === 'owner') {
    throw new ValidationError('owner role is reserved for the org creator');
  }

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + EXPIRES_MS);

  // Send the invite email BEFORE persisting the row (fail fast): if the
  // send throws we never write the invitation, so the caller surfaces the
  // error and can retry cleanly — instead of leaving a "pending" row in the
  // db that the recipient was never emailed about and has no resend path.
  // A failed send also leaves any prior pending invite (and its still-valid
  // token) untouched.
  const acceptURL = `${input.callbackURL}?token=${encodeURIComponent(token)}`;
  await sendInvitation(input.email, acceptURL);

  const db = getDb();
  const [row] = await db
    .insert(orgInvitations)
    .values({
      id: newId('ev'),
      orgId: input.orgId,
      email: input.email.toLowerCase(),
      role: input.role,
      tokenHash,
      invitedBy: input.invitedBy,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [orgInvitations.orgId, orgInvitations.email],
      set: { tokenHash, role: input.role, expiresAt, revokedAt: null, acceptedAt: null },
    })
    .returning();
  if (!row) throw new Error('org invitation insert returned no row');

  return row;
}

export async function listOrgInvitations(orgId: string): Promise<OrgInvitation[]> {
  const db = getDb();
  return db.select().from(orgInvitations).where(eq(orgInvitations.orgId, orgId));
}

export async function revokeOrgInvitation(orgId: string, invitationId: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(orgInvitations)
    .where(and(eq(orgInvitations.id, invitationId), eq(orgInvitations.orgId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError('invitation', invitationId);
  if (row.acceptedAt) {
    throw new ValidationError('cannot revoke an already-accepted invitation');
  }
  await db
    .update(orgInvitations)
    .set({ revokedAt: new Date() })
    .where(eq(orgInvitations.id, invitationId));
}

export interface AcceptedOrgInvitation {
  orgId: string;
  role: OrgRole;
}

export async function acceptOrgInvitation(args: {
  token: string;
  userId: string;
  userEmail: string;
}): Promise<AcceptedOrgInvitation> {
  const tokenHash = createHash('sha256').update(args.token).digest('hex');
  const db = getDb();

  const [inv] = await db
    .select()
    .from(orgInvitations)
    .where(eq(orgInvitations.tokenHash, tokenHash))
    .limit(1);
  if (!inv) {
    throw new ValidationError('invitation not found or already used');
  }
  if (inv.revokedAt) throw new ValidationError('invitation was revoked');
  if (inv.acceptedAt) throw new ValidationError('invitation already accepted');
  if (inv.expiresAt.getTime() < Date.now()) {
    throw new ValidationError('invitation expired');
  }
  // Bind the invite to the recipient email — case-insensitive. Prevents
  // forwarding the email link to a different account.
  if (inv.email.toLowerCase() !== args.userEmail.toLowerCase()) {
    throw new ValidationError('invitation email does not match the signed-in user');
  }

  // Make sure the org still exists + isn't soft-deleted.
  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, inv.orgId), isNull(organizations.deletedAt)))
    .limit(1);
  if (!org) throw new ValidationError('org no longer exists');

  // Member-insert + invitation-mark-accepted in ONE transaction: a crash
  // between them left the user added but the invite still "pending", so a
  // retry re-ran the insert and hit the unique constraint → permanent
  // lockout. Atomic now (both commit or neither).
  await db.transaction(async (tx) => {
    await tx
      .insert(orgMembers)
      .values({ orgId: inv.orgId, userId: args.userId, role: inv.role })
      .onConflictDoUpdate({
        target: [orgMembers.orgId, orgMembers.userId],
        set: { role: inv.role },
      });

    await tx
      .update(orgInvitations)
      .set({ acceptedAt: new Date() })
      .where(eq(orgInvitations.id, inv.id));
  });

  return { orgId: inv.orgId, role: inv.role };
}

/**
 * Pending org invitations for an email — used by the dashboard to surface
 * "you have a pending team invitation" banners. Joins to organizations
 * so the surface can render the team name.
 */
export async function pendingOrgInvitationsForEmail(email: string): Promise<
  Array<{
    id: string;
    orgId: string;
    orgName: string;
    role: OrgRole;
    expiresAt: Date;
  }>
> {
  const db = getDb();
  const rows = await db
    .select({
      id: orgInvitations.id,
      orgId: orgInvitations.orgId,
      orgName: organizations.name,
      role: orgInvitations.role,
      expiresAt: orgInvitations.expiresAt,
    })
    .from(orgInvitations)
    .innerJoin(organizations, eq(organizations.id, orgInvitations.orgId))
    .where(
      and(
        eq(orgInvitations.email, email.toLowerCase()),
        isNull(orgInvitations.acceptedAt),
        isNull(orgInvitations.revokedAt),
      ),
    );
  // Filter expired in JS — the row count is tiny per email and avoids a
  // gte() comparison against a parameterised now() that drizzle struggles
  // to type narrowly.
  const now = Date.now();
  return rows.filter((r) => r.expiresAt.getTime() > now);
}
