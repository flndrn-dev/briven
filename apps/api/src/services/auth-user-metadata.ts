/**
 * User metadata service — public and private JSON blobs per user.
 *
 * Public metadata is readable from both frontend and backend.
 * Private metadata is backend-only (never exposed to the client SDK).
 *
 * One row per user in `_briven_auth_user_metadata`; created lazily on
 * first write so existing users don't need a backfill migration.
 */

import { runInProjectDatabase } from '../db/data-plane.js';

export interface UserMetadata {
  publicMetadata: Record<string, unknown>;
  privateMetadata: Record<string, unknown>;
}

/**
 * Get a user's metadata. Returns empty objects when no row exists yet.
 */
export async function getUserMetadata(
  projectId: string,
  userId: string,
): Promise<UserMetadata> {
  const rows = await runInProjectDatabase<
    Array<{ public_metadata: unknown; private_metadata: unknown }>
  >(projectId, async (tx) =>
    tx.unsafe(
      `SELECT public_metadata, private_metadata
       FROM "_briven_auth_user_metadata"
       WHERE user_id = $1
       LIMIT 1`,
      [userId] as never,
    ) as never,
  );
  const row = rows[0];
  if (!row) return { publicMetadata: {}, privateMetadata: {} };
  return {
    publicMetadata: (row.public_metadata as Record<string, unknown>) ?? {},
    privateMetadata: (row.private_metadata as Record<string, unknown>) ?? {},
  };
}

/**
 * Get ONLY the public metadata for a user. Safe to expose via the
 * unauthenticated / lightly-authenticated frontend surface.
 */
export async function getUserPublicMetadata(
  projectId: string,
  userId: string,
): Promise<Record<string, unknown>> {
  const rows = await runInProjectDatabase<Array<{ public_metadata: unknown }>>(
    projectId,
    async (tx) =>
      tx.unsafe(
        `SELECT public_metadata
         FROM "_briven_auth_user_metadata"
         WHERE user_id = $1
         LIMIT 1`,
        [userId] as never,
      ) as never,
  );
  const row = rows[0];
  return (row?.public_metadata as Record<string, unknown>) ?? {};
}

/**
 * Set (replace) a user's metadata. Creates the row if absent.
 * `publicMeta` and `privateMeta` are merged with existing values when
 * `merge = true` (default), or replaced wholesale when `merge = false`.
 */
export async function setUserMetadata(
  projectId: string,
  userId: string,
  patch: {
    publicMetadata?: Record<string, unknown>;
    privateMetadata?: Record<string, unknown>;
  },
  opts: { merge?: boolean } = {},
): Promise<UserMetadata> {
  const merge = opts.merge ?? true;

  return runInProjectDatabase<UserMetadata>(projectId, async (tx) => {
    // Probe for existing row.
    const existing = await tx.unsafe(
      `SELECT public_metadata, private_metadata
       FROM "_briven_auth_user_metadata"
       WHERE user_id = $1
       LIMIT 1`,
      [userId] as never,
    );

    const current = (existing as Array<{ public_metadata: unknown; private_metadata: unknown }>)[0];

    const nextPublic = merge
      ? { ...((current?.public_metadata as Record<string, unknown>) ?? {}), ...(patch.publicMetadata ?? {}) }
      : (patch.publicMetadata ?? (current?.public_metadata as Record<string, unknown>) ?? {});

    const nextPrivate = merge
      ? { ...((current?.private_metadata as Record<string, unknown>) ?? {}), ...(patch.privateMetadata ?? {}) }
      : (patch.privateMetadata ?? (current?.private_metadata as Record<string, unknown>) ?? {});

    if (current) {
      await tx.unsafe(
        `UPDATE "_briven_auth_user_metadata"
         SET public_metadata = $2::jsonb, private_metadata = $3::jsonb, updated_at = now()
         WHERE user_id = $1`,
        [userId, JSON.stringify(nextPublic), JSON.stringify(nextPrivate)] as never,
      );
    } else {
      await tx.unsafe(
        `INSERT INTO "_briven_auth_user_metadata" (id, user_id, public_metadata, private_metadata, created_at, updated_at)
         VALUES (gen_random_uuid()::text, $1, $2::jsonb, $3::jsonb, now(), now())`,
        [userId, JSON.stringify(nextPublic), JSON.stringify(nextPrivate)] as never,
      );
    }

    return { publicMetadata: nextPublic, privateMetadata: nextPrivate };
  });
}

/**
 * Delete a user's metadata row. Idempotent — no-op if no row exists.
 */
export async function deleteUserMetadata(projectId: string, userId: string): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `DELETE FROM "_briven_auth_user_metadata" WHERE user_id = $1`,
      [userId] as never,
    );
  });
}
