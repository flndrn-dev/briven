/**
 * OAuth account linking — Gap Fix #4.
 *
 * Automatically links OAuth accounts to existing users when the email
 * matches.  Prevents duplicate user rows for the same person across
 * multiple social providers.
 */

import { runInProjectDatabase } from '../db/data-plane.js';

/**
 * After an OAuth user is created, check whether another user already
 * exists with the same email.  If so, move the OAuth account to the
 * existing user and delete the duplicate user.
 *
 * This runs inside `user.create.after` so the session has not been
 * created yet — Better Auth creates the session after the user hook.
 */
export async function maybeAutoLinkOAuthAccount(
  projectId: string,
  newUserId: string,
  email: string,
): Promise<{ linkedToUserId: string } | null> {
  const normalizedEmail = email.toLowerCase().trim();

  return runInProjectDatabase(projectId, async (tx) => {
    // Find all users with this email (including the one just created).
    const users = (await tx.unsafe(
      `SELECT id, email FROM "_briven_auth_users" WHERE lower(email) = lower($1) ORDER BY created_at ASC`,
      [normalizedEmail] as never,
    )) as Array<{ id: string; email: string }>;

    if (users.length < 2) return null;

    const existingUser = users[0]!;
    if (existingUser.id === newUserId) return null; // The new user is the oldest — nothing to do.

    // Find the OAuth account(s) belonging to the new user.
    const accounts = (await tx.unsafe(
      `SELECT id, provider_id, account_id FROM "_briven_auth_accounts" WHERE user_id = $1`,
      [newUserId] as never,
    )) as Array<{ id: string; provider_id: string; account_id: string }>;

    if (accounts.length === 0) return null;

    // Move each account to the existing user.
    for (const account of accounts) {
      // Check for duplicate (provider_id, account_id) on the target user.
      const dup = (await tx.unsafe(
        `SELECT id FROM "_briven_auth_accounts" WHERE user_id = $1 AND provider_id = $2 AND account_id = $3 LIMIT 1`,
        [existingUser.id, account.provider_id, account.account_id] as never,
      )) as Array<{ id: string }>;

      if (dup.length > 0) {
        // Already linked — delete the duplicate account row.
        await tx.unsafe(
          `DELETE FROM "_briven_auth_accounts" WHERE id = $1`,
          [account.id] as never,
        );
      } else {
        await tx.unsafe(
          `UPDATE "_briven_auth_accounts" SET user_id = $1, updated_at = now() WHERE id = $2`,
          [existingUser.id, account.id] as never,
        );
      }
    }

    // Delete the duplicate user (cascades sessions, etc. via FK).
    await tx.unsafe(
      `DELETE FROM "_briven_auth_users" WHERE id = $1`,
      [newUserId] as never,
    );

    return { linkedToUserId: existingUser.id };
  });
}

/**
 * List all linked accounts for a user.
 */
export async function listUserAccounts(
  projectId: string,
  userId: string,
): Promise<Array<{ id: string; providerId: string; accountId: string; createdAt: Date }>> {
  const rows = await runInProjectDatabase(projectId, async (tx) => {
    return (await tx.unsafe(
      `SELECT id, provider_id, account_id, created_at FROM "_briven_auth_accounts" WHERE user_id = $1`,
      [userId] as never,
    )) as Array<{ id: string; provider_id: string; account_id: string; created_at: Date }>;
  });
  return rows.map((r) => ({
    id: r.id,
    providerId: r.provider_id,
    accountId: r.account_id,
    createdAt: r.created_at,
  }));
}
