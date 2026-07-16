/**
 * User emails service — multiple verified email addresses per user.
 *
 * The primary email (the `email` column on `_briven_auth_users`) is the
 * sign-in identifier. This service manages *additional* emails.
 *
 * Phase 3 — BUILD_PLAN.md.
 */

import { ValidationError } from '@briven/shared';

import { runInProjectDatabase } from '../db/data-plane.js';

export interface UserEmail {
  id: string;
  email: string;
  verified: boolean;
  primary: boolean;
  createdAt: Date;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * List all additional emails for a user.
 */
export async function listUserEmails(
  projectId: string,
  userId: string,
): Promise<UserEmail[]> {
  const rows = await runInProjectDatabase<
    Array<{
      id: string;
      email: string;
      verified: boolean;
      primary: boolean;
      created_at: Date;
    }>
  >(projectId, async (tx) =>
    tx.unsafe(
      `SELECT id, email, verified, primary, created_at
       FROM "_briven_auth_user_emails"
       WHERE user_id = $1
       ORDER BY primary DESC, created_at DESC`,
      [userId] as never,
    ) as never,
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    verified: r.verified,
    primary: r.primary,
    createdAt: r.created_at,
  }));
}

/**
 * Add an email address to a user. Idempotent — if the email already
 * exists for this user, returns the existing row.
 */
export async function addUserEmail(
  projectId: string,
  userId: string,
  email: string,
): Promise<UserEmail> {
  const normalized = normalizeEmail(email);
  if (!EMAIL_RE.test(normalized)) {
    throw new ValidationError('invalid email address');
  }

  const rows = await runInProjectDatabase<
    Array<{
      id: string;
      email: string;
      verified: boolean;
      primary: boolean;
      created_at: Date;
    }>
  >(projectId, async (tx) =>
    tx.unsafe(
      `INSERT INTO "_briven_auth_user_emails" (id, user_id, email, verified, primary, created_at, updated_at)
       VALUES (gen_random_uuid()::text, $1, $2, false, false, now(), now())
       ON CONFLICT (user_id, email) DO UPDATE SET updated_at = now()
       RETURNING id, email, verified, primary, created_at`,
      [userId, normalized] as never,
    ) as never,
  );
  const row = rows[0];
  if (!row) throw new Error('email insert returned no row');
  return {
    id: row.id,
    email: row.email,
    verified: row.verified,
    primary: row.primary,
    createdAt: row.created_at,
  };
}

/**
 * Mark an email as verified.
 */
export async function verifyUserEmail(
  projectId: string,
  userId: string,
  emailId: string,
): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `UPDATE "_briven_auth_user_emails"
       SET verified = true, updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [emailId, userId] as never,
    );
  });
}

/**
 * Set an email as the primary additional email. Unsets primary on all
 * other emails for this user.
 */
export async function setPrimaryEmail(
  projectId: string,
  userId: string,
  emailId: string,
): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `UPDATE "_briven_auth_user_emails"
       SET primary = false, updated_at = now()
       WHERE user_id = $1`,
      [userId] as never,
    );
    await tx.unsafe(
      `UPDATE "_briven_auth_user_emails"
       SET primary = true, updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [emailId, userId] as never,
    );
  });
}

/**
 * Remove an email address from a user.
 */
export async function removeUserEmail(
  projectId: string,
  userId: string,
  emailId: string,
): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `DELETE FROM "_briven_auth_user_emails"
       WHERE id = $1 AND user_id = $2`,
      [emailId, userId] as never,
    );
  });
}
