/**
 * briven-engine sessions on Doltgres.
 */

import { createHash, randomBytes } from 'node:crypto';

import { getEnginePool } from './db.js';

export type EngineSession = {
  sessionHandle: string;
  userId: string;
  tenantId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
};

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function hash(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}

export async function createEngineSession(input: {
  userId: string;
  tenantId: string;
  ttlDays?: number;
}): Promise<EngineSession> {
  // Block held / archived accounts from minting new sessions (all login paths).
  try {
    const { getUserAccessBlock } = await import('./users.js');
    const block = await getUserAccessBlock(input.userId);
    if (block === 'held') {
      throw new Error('user_held');
    }
    if (block === 'archived') {
      throw new Error('user_archived');
    }
  } catch (err) {
    if (err instanceof Error && (err.message === 'user_held' || err.message === 'user_archived')) {
      throw err;
    }
    // Schema not ready — do not brick login.
  }

  const sessionHandle = `sh_${randomBytes(16).toString('hex')}`;
  // Phase 2: access cookie value IS the session handle (Doltgres PK lookup).
  // Keep field name accessToken for FDI/cookie compatibility.
  const accessToken = sessionHandle;
  const refreshToken = newToken();
  const days = input.ttlDays ?? 30;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const pool = getEnginePool();

  await pool.query(
    `INSERT INTO be_sessions
      (session_handle, user_id, tenant_id, refresh_token_hash, access_payload_json, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      sessionHandle,
      input.userId,
      input.tenantId,
      hash(refreshToken),
      JSON.stringify({ sub: input.userId, tenantId: input.tenantId }),
      expiresAt.toISOString(),
    ],
  );

  return {
    sessionHandle,
    userId: input.userId,
    tenantId: input.tenantId,
    accessToken,
    refreshToken,
    expiresAt,
  };
}

export async function getSessionByHandle(
  sessionHandle: string,
): Promise<{ userId: string; tenantId: string; expiresAt: Date } | null> {
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT user_id, tenant_id, expires_at FROM be_sessions
     WHERE session_handle = $1 LIMIT 1`,
    [sessionHandle],
  );
  const row = res.rows[0] as
    | { user_id: string; tenant_id: string; expires_at: Date | string }
    | undefined;
  if (!row) return null;
  const expiresAt = new Date(row.expires_at);
  if (expiresAt.getTime() < Date.now()) return null;
  return { userId: row.user_id, tenantId: row.tenant_id, expiresAt };
}

export async function revokeEngineSession(sessionHandle: string): Promise<boolean> {
  const pool = getEnginePool();
  // Capture user/tenant before delete for audit
  let userId: string | null = null;
  let tenantId: string | null = null;
  try {
    const prev = await pool.query(
      `SELECT user_id, tenant_id FROM be_sessions WHERE session_handle = $1 LIMIT 1`,
      [sessionHandle],
    );
    const row = prev.rows[0] as { user_id?: string; tenant_id?: string } | undefined;
    userId = row?.user_id ?? null;
    tenantId = row?.tenant_id ?? null;
  } catch {
    /* ignore */
  }
  const res = await pool.query(`DELETE FROM be_sessions WHERE session_handle = $1`, [
    sessionHandle,
  ]);
  const ok = (res.rowCount ?? 0) > 0;
  if (ok) {
    const { recordBrivenEngineAudit } = await import('./audit.js');
    void recordBrivenEngineAudit({
      action: 'session.revoked',
      tenantId,
      userId,
      metadata: { sessionHandle },
    });
  }
  return ok;
}

export async function revokeAllForUser(userId: string): Promise<number> {
  const pool = getEnginePool();
  const res = await pool.query(`DELETE FROM be_sessions WHERE user_id = $1`, [userId]);
  return res.rowCount ?? 0;
}

export async function listSessionHandles(userId: string): Promise<string[]> {
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT session_handle FROM be_sessions WHERE user_id = $1 AND expires_at > NOW()`,
    [userId],
  );
  return res.rows.map((r: { session_handle: string }) => r.session_handle);
}

/** Recent active sessions for yellow dashboard (optionally one tenant). */
export async function listRecentEngineSessions(
  limit = 50,
  opts?: { tenantId?: string },
): Promise<
  Array<{
    handle: string;
    userId: string;
    tenantId: string;
    expiresAt: string;
    createdAt: string;
  }>
> {
  const pool = getEnginePool();
  const res = opts?.tenantId
    ? await pool.query(
        `SELECT session_handle, user_id, tenant_id, expires_at, created_at
         FROM be_sessions
         WHERE expires_at > NOW() AND tenant_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [opts.tenantId, limit],
      )
    : await pool.query(
        `SELECT session_handle, user_id, tenant_id, expires_at, created_at
         FROM be_sessions
         WHERE expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit],
      );
  return (
    res.rows as Array<{
      session_handle: string;
      user_id: string;
      tenant_id: string;
      expires_at: Date | string;
      created_at: Date | string;
    }>
  ).map((r) => ({
    handle: r.session_handle,
    userId: r.user_id,
    tenantId: r.tenant_id,
    expiresAt: new Date(r.expires_at).toISOString(),
    createdAt: new Date(r.created_at).toISOString(),
  }));
}
