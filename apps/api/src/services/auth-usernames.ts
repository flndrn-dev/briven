/**
 * Username authentication — Phase 7.3.
 *
 * Users can set a unique username and use it instead of their email
 * to sign in.  The username resolves to the user's email internally,
 * then the normal Better Auth email/password flow is used.
 */

import { ValidationError } from '@briven/shared';

import { runInProjectDatabase } from '../db/data-plane.js';

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;

export function validateUsername(username: string): void {
  if (!USERNAME_RE.test(username)) {
    throw new ValidationError(
      'username must be 3-32 characters and contain only letters, numbers, underscores, and hyphens',
    );
  }
}

export async function createUsername(
  projectId: string,
  userId: string,
  username: string,
): Promise<void> {
  validateUsername(username);
  const id = crypto.randomUUID();
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `INSERT INTO "_briven_auth_user_usernames" (id, user_id, username) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET username = $3, updated_at = now()`,
      [id, userId, username] as never,
    );
  });
}

export async function deleteUsername(projectId: string, userId: string): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `DELETE FROM "_briven_auth_user_usernames" WHERE user_id = $1`,
      [userId] as never,
    );
  });
}

export async function resolveUsernameToEmail(
  projectId: string,
  username: string,
): Promise<{ userId: string; email: string } | null> {
  const rows = await runInProjectDatabase(projectId, async (tx) => {
    return (await tx.unsafe(
      `SELECT u.id, u.email
       FROM "_briven_auth_users" u
       JOIN "_briven_auth_user_usernames" n ON n.user_id = u.id
       WHERE n.username = $1
       LIMIT 1`,
      [username] as never,
    )) as Array<{ id: string; email: string }>;
  });
  if (!rows[0]) return null;
  return { userId: rows[0].id, email: rows[0].email };
}

export async function getUsernameByUserId(
  projectId: string,
  userId: string,
): Promise<string | null> {
  const rows = await runInProjectDatabase(projectId, async (tx) => {
    return (await tx.unsafe(
      `SELECT username FROM "_briven_auth_user_usernames" WHERE user_id = $1 LIMIT 1`,
      [userId] as never,
    )) as Array<{ username: string }>;
  });
  return rows[0]?.username ?? null;
}
