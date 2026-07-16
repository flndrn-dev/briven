/**
 * Admin impersonation — create a session for a target user in a project's
 * tenant so an admin can act on their behalf. The session is real
 * (signed cookie + DB row) and works with all normal tenant APIs.
 *
 * Phase 6.2 adds:
 *   - Tenant audit log entry on start
 *   - `_briven_auth_impersonation_sessions` tracking
 *   - Stop-impersonation support
 */

import { randomBytes } from 'node:crypto';

import { runInProjectDatabase } from '../db/data-plane.js';

const IMPERSONATION_EXPIRY_MINUTES = 30;

export async function createImpersonationSession(
  projectId: string,
  targetUserId: string,
  impersonatedBy: string,
): Promise<{ sessionToken: string; expiresAt: Date }> {
  const token = `imp_${randomBytes(32).toString('hex')}`;
  const sessionId = `imp_sess_${randomBytes(8).toString('hex')}`;
  const expiresAt = new Date(Date.now() + IMPERSONATION_EXPIRY_MINUTES * 60 * 1000);

  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `INSERT INTO "_briven_auth_sessions" (id, user_id, token, expires_at, ip_address, user_agent, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NULL, 'briven-admin-impersonation', now(), now())`,
      [sessionId, targetUserId, token, expiresAt] as never[],
    );

    await tx.unsafe(
      `INSERT INTO "_briven_auth_impersonation_sessions" (id, session_id, impersonated_by, target_user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())`,
      [`imp_is_${randomBytes(8).toString('hex')}`, sessionId, impersonatedBy, targetUserId] as never[],
    );

    await tx.unsafe(
      `INSERT INTO "_briven_auth_audit_log" (id, user_id, action, ip_address_hash, user_agent, metadata, occurred_at)
       VALUES ($1, $2, 'impersonation.start', NULL, 'briven-admin-impersonation', $3, now())`,
      [
        `imp_audit_${randomBytes(8).toString('hex')}`,
        targetUserId,
        JSON.stringify({ impersonatedBy, targetUserId }),
      ] as never[],
    );
  });

  return { sessionToken: token, expiresAt };
}

export async function stopImpersonationSession(
  projectId: string,
  sessionToken: string,
  stoppedBy: string,
): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    // Find the session
    const sessionRows = await tx.unsafe(
      `SELECT id, user_id FROM "_briven_auth_sessions" WHERE token = $1 LIMIT 1`,
      [sessionToken] as never[],
    ) as Array<{ id: string; user_id: string }>;

    const session = sessionRows[0];
    if (!session) return;

    // Mark impersonation as stopped
    await tx.unsafe(
      `UPDATE "_briven_auth_impersonation_sessions" SET stopped_at = now(), updated_at = now()
       WHERE session_id = $1 AND stopped_at IS NULL`,
      [session.id] as never[],
    );

    // Revoke the session
    await tx.unsafe(
      `DELETE FROM "_briven_auth_sessions" WHERE id = $1`,
      [session.id] as never[],
    );

    // Audit log
    await tx.unsafe(
      `INSERT INTO "_briven_auth_audit_log" (id, user_id, action, ip_address_hash, user_agent, metadata, occurred_at)
       VALUES ($1, $2, 'impersonation.stop', NULL, 'briven-admin-impersonation', $3, now())`,
      [
        `imp_audit_${randomBytes(8).toString('hex')}`,
        session.user_id,
        JSON.stringify({ stoppedBy, targetUserId: session.user_id }),
      ] as never[],
    );
  });
}

export async function getActiveImpersonation(
  projectId: string,
  sessionToken: string,
): Promise<{ impersonatedBy: string; targetUserId: string } | null> {
  const rows = await runInProjectDatabase(projectId, async (tx) => {
    return (await tx.unsafe(
      `SELECT i.impersonated_by, i.target_user_id
       FROM "_briven_auth_impersonation_sessions" i
       INNER JOIN "_briven_auth_sessions" s ON s.id = i.session_id
       WHERE s.token = $1 AND i.stopped_at IS NULL AND s.expires_at > now()
       LIMIT 1`,
      [sessionToken] as never[],
    )) as Array<{ impersonated_by: string; target_user_id: string }>;
  });

  const row = rows[0];
  if (!row) return null;
  return { impersonatedBy: row.impersonated_by, targetUserId: row.target_user_id };
}
