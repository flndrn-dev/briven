/**
 * OAuth account linking — Gap Fix #4 / Sprint S3.
 *
 * Automatically links OAuth accounts to existing users when the email
 * matches (Gmail-normalized). Manual unlink for admin repair.
 */

import { NotFoundError, ValidationError } from '@briven/shared';

import { runInProjectDatabase } from '../db/data-plane.js';
import { normalizeEmail } from './auth-security.js';

/**
 * After an OAuth user is created, check whether another user already
 * exists with the same normalized email.  If so, move the OAuth account(s)
 * to the existing user and delete the duplicate user.
 */
export async function maybeAutoLinkOAuthAccount(
  projectId: string,
  newUserId: string,
  email: string,
): Promise<{ linkedToUserId: string } | null> {
  const normalizedEmail = normalizeEmail(email);

  return runInProjectDatabase(projectId, async (tx) => {
    // Candidate set: exact lower(email) match, or all gmail/googlemail rows
    // (dots/+ aliases only matter for those domains).
    const domain = normalizedEmail.slice(normalizedEmail.lastIndexOf('@') + 1);
    const candidates =
      domain === 'gmail.com'
        ? ((await tx.unsafe(
            `SELECT id, email FROM "_briven_auth_users"
             WHERE lower(email) LIKE '%@gmail.com' OR lower(email) LIKE '%@googlemail.com'
             ORDER BY created_at ASC`,
            [] as never,
          )) as Array<{ id: string; email: string }>)
        : ((await tx.unsafe(
            `SELECT id, email FROM "_briven_auth_users"
             WHERE lower(email) = lower($1)
             ORDER BY created_at ASC`,
            [email] as never,
          )) as Array<{ id: string; email: string }>);

    const matches = candidates.filter((u) => normalizeEmail(u.email) === normalizedEmail);
    if (matches.length < 2) return null;

    const existingUser = matches[0]!;
    if (existingUser.id === newUserId) return null;

    const accounts = (await tx.unsafe(
      `SELECT id, provider_id, account_id FROM "_briven_auth_accounts" WHERE user_id = $1`,
      [newUserId] as never,
    )) as Array<{ id: string; provider_id: string; account_id: string }>;

    if (accounts.length === 0) return null;

    for (const account of accounts) {
      const dup = (await tx.unsafe(
        `SELECT id FROM "_briven_auth_accounts" WHERE user_id = $1 AND provider_id = $2 AND account_id = $3 LIMIT 1`,
        [existingUser.id, account.provider_id, account.account_id] as never,
      )) as Array<{ id: string }>;

      if (dup.length > 0) {
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

    await tx.unsafe(
      `DELETE FROM "_briven_auth_users" WHERE id = $1`,
      [newUserId] as never,
    );

    return { linkedToUserId: existingUser.id };
  });
}

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

/**
 * Unlink one OAuth/social account from a user.
 * Refuses to remove the last remaining sign-in method (credential or sole account).
 */
export async function unlinkUserAccount(
  projectId: string,
  userId: string,
  accountId: string,
): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    const accounts = (await tx.unsafe(
      `SELECT id, provider_id FROM "_briven_auth_accounts" WHERE user_id = $1`,
      [userId] as never,
    )) as Array<{ id: string; provider_id: string }>;

    const target = accounts.find((a) => a.id === accountId);
    if (!target) {
      throw new NotFoundError('auth_account', accountId);
    }

    if (accounts.length <= 1) {
      throw new ValidationError(
        'cannot unlink the only sign-in method — add another provider or set a password first',
      );
    }

    // Keep at least one path in: either credential remains, or another OAuth.
    const others = accounts.filter((a) => a.id !== accountId);
    if (others.length === 0) {
      throw new ValidationError('cannot unlink the only sign-in method');
    }

    await tx.unsafe(
      `DELETE FROM "_briven_auth_accounts" WHERE id = $1 AND user_id = $2`,
      [accountId, userId] as never,
    );
  });
}
