/**
 * Admin impersonation — create a session for a target user in a project's
 * tenant so a superadmin can act on their behalf. The session is real
 * (signed cookie + DB row) and works with all normal tenant APIs.
 */

import { randomBytes } from 'node:crypto';

import { runInProjectDatabase } from '../db/data-plane.js';

const IMPERSONATION_EXPIRY_MINUTES = 30;

export async function createImpersonationSession(
  projectId: string,
  targetUserId: string,
): Promise<{ sessionToken: string; expiresAt: Date }> {
  const token = `imp_${randomBytes(32).toString('hex')}`;
  const expiresAt = new Date(Date.now() + IMPERSONATION_EXPIRY_MINUTES * 60 * 1000);

  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `INSERT INTO "_briven_auth_sessions" (id, user_id, token, expires_at, ip_address, user_agent, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NULL, 'briven-admin-impersonation', now(), now())`,
      [`imp_sess_${randomBytes(8).toString('hex')}`, targetUserId, token, expiresAt] as never[],
    );
  });

  return { sessionToken: token, expiresAt };
}
