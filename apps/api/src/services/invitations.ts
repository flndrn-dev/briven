import { createHash, randomBytes } from 'node:crypto';

import { newId, NotFoundError, ValidationError } from '@briven/shared';
import { and, eq, isNull } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  memberRole,
  projectInvitations,
  projectMembers,
  projects,
  users,
  type MemberRole,
  type ProjectInvitation,
} from '../db/schema.js';
import { sendInvitation } from '../lib/email.js';

const EXPIRES_MS = 7 * 24 * 60 * 60 * 1000;

export interface InviteInput {
  projectId: string;
  email: string;
  role: MemberRole;
  invitedBy: string;
  callbackURL: string;
}

export async function createInvitation(input: InviteInput): Promise<ProjectInvitation> {
  if (!memberRole.includes(input.role)) {
    throw new ValidationError('invalid role', { role: input.role });
  }
  if (input.role === 'owner') {
    throw new ValidationError('owner role is reserved for the project creator');
  }

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + EXPIRES_MS);

  const db = getDb();
  const [row] = await db
    .insert(projectInvitations)
    .values({
      id: newId('ev'),
      projectId: input.projectId,
      email: input.email.toLowerCase(),
      role: input.role,
      tokenHash,
      invitedBy: input.invitedBy,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [projectInvitations.projectId, projectInvitations.email],
      set: { tokenHash, role: input.role, expiresAt, revokedAt: null, acceptedAt: null },
    })
    .returning();
  if (!row) throw new Error('invitation insert returned no row');

  // The plaintext token only lives in transit — it rides in the invite
  // email and in the `accept` URL the recipient clicks. The DB only has
  // the hash, so an operator reading postgres cannot impersonate.
  const acceptURL = `${input.callbackURL}?token=${encodeURIComponent(token)}`;
  await sendInvitation(input.email, acceptURL);
  return row;
}

export async function listInvitations(projectId: string): Promise<ProjectInvitation[]> {
  const db = getDb();
  return db.select().from(projectInvitations).where(eq(projectInvitations.projectId, projectId));
}

export async function revokeInvitation(projectId: string, invitationId: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(projectInvitations)
    .where(
      and(eq(projectInvitations.id, invitationId), eq(projectInvitations.projectId, projectId)),
    )
    .limit(1);
  if (!row) throw new NotFoundError('invitation', invitationId);
  if (row.revokedAt || row.acceptedAt) return; // idempotent
  await db
    .update(projectInvitations)
    .set({ revokedAt: new Date() })
    .where(eq(projectInvitations.id, invitationId));
}

export interface AcceptedInvitation {
  projectId: string;
  userId: string;
  role: MemberRole;
}

/**
 * Accept an invitation on behalf of the currently-signed-in user. Throws
 * ValidationError if the token is wrong / expired / already used.
 */
export async function acceptInvitation(
  userId: string,
  userEmail: string,
  token: string,
): Promise<AcceptedInvitation> {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const db = getDb();
  const [invite] = await db
    .select()
    .from(projectInvitations)
    .where(
      and(
        eq(projectInvitations.tokenHash, tokenHash),
        isNull(projectInvitations.acceptedAt),
        isNull(projectInvitations.revokedAt),
      ),
    )
    .limit(1);
  if (!invite) throw new ValidationError('invitation not found or already used');
  if (invite.expiresAt.getTime() < Date.now()) {
    throw new ValidationError('invitation expired');
  }
  if (invite.email.toLowerCase() !== userEmail.toLowerCase()) {
    throw new ValidationError('invitation was sent to a different email');
  }

  // Mark accepted + add membership in one transaction.
  await db.transaction(async (tx) => {
    await tx
      .update(projectInvitations)
      .set({ acceptedAt: new Date() })
      .where(eq(projectInvitations.id, invite.id));

    // Upsert membership — a user accepting a second time is a no-op.
    await tx
      .insert(projectMembers)
      .values({ projectId: invite.projectId, userId, role: invite.role })
      .onConflictDoNothing();
  });

  return { projectId: invite.projectId, userId, role: invite.role };
}

/**
 * Look up any pending invitations for a user's email that the signed-in
 * user owns. Used by the dashboard's "pending invitations" surface. Joins
 * to `projects` so the surface can show the project name without a
 * second round-trip per row.
 */
export async function pendingInvitationsForEmail(email: string): Promise<
  Array<{
    id: string;
    projectId: string;
    projectName: string;
    role: MemberRole;
    invitedBy: string | null;
    expiresAt: Date;
  }>
> {
  const db = getDb();
  const rows = await db
    .select({
      id: projectInvitations.id,
      projectId: projectInvitations.projectId,
      projectName: projects.name,
      role: projectInvitations.role,
      invitedBy: projectInvitations.invitedBy,
      expiresAt: projectInvitations.expiresAt,
    })
    .from(projectInvitations)
    .innerJoin(projects, eq(projects.id, projectInvitations.projectId))
    .where(
      and(
        eq(projectInvitations.email, email.toLowerCase()),
        isNull(projectInvitations.acceptedAt),
        isNull(projectInvitations.revokedAt),
        isNull(projects.deletedAt),
      ),
    );
  return rows;
}

/**
 * Accept an invitation by its id. Session-auth replaces the token —
 * being signed in with an email that matches the invite is sufficient
 * proof of identity, and avoids leaking the one-time token through the
 * dashboard listing API. Token-based acceptance (the email-link flow,
 * `acceptInvitation` above) stays intact for users who haven't signed
 * in yet.
 */
export async function acceptInvitationById(
  userId: string,
  userEmail: string,
  invitationId: string,
): Promise<AcceptedInvitation> {
  const db = getDb();
  const [invite] = await db
    .select()
    .from(projectInvitations)
    .where(
      and(
        eq(projectInvitations.id, invitationId),
        isNull(projectInvitations.acceptedAt),
        isNull(projectInvitations.revokedAt),
      ),
    )
    .limit(1);
  if (!invite) throw new NotFoundError('invitation', invitationId);
  if (invite.expiresAt.getTime() < Date.now()) {
    throw new ValidationError('invitation expired');
  }
  if (invite.email.toLowerCase() !== userEmail.toLowerCase()) {
    throw new ValidationError('invitation was sent to a different email');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(projectInvitations)
      .set({ acceptedAt: new Date() })
      .where(eq(projectInvitations.id, invite.id));
    await tx
      .insert(projectMembers)
      .values({ projectId: invite.projectId, userId, role: invite.role })
      .onConflictDoNothing();
  });

  return { projectId: invite.projectId, userId, role: invite.role };
}

// Keep users import referenced for type flow
void users;
