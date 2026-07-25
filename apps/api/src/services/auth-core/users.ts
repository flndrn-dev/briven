/**
 * briven-engine users on Doltgres — list, detail, hold, archive, delete.
 */

import { getEnginePool } from './db.js';
import { isAuthCoreInitialized } from './engine.js';
import { revokeAllForUser } from './native-session.js';
import { recordBrivenEngineAudit } from './audit.js';

export type BrivenEngineUserStatus = 'active' | 'held' | 'archived';

export type BrivenEngineUserSummary = {
  id: string;
  emails: string[];
  phoneNumbers: string[];
  tenantId: string;
  timeJoined: number;
  status: BrivenEngineUserStatus;
  heldAt: string | null;
  heldReason: string | null;
  archivedAt: string | null;
  archivedReason: string | null;
  engine: 'briven-engine';
  storage: 'doltgres';
};

export type BrivenEngineUserDetail = BrivenEngineUserSummary & {
  emailVerified: boolean;
  metadata: Record<string, unknown>;
  roles: string[];
  linkedLogins: Array<{
    id: string;
    provider: string;
    providerUserId: string;
    createdAt: string;
  }>;
  sessions: Array<{
    handle: string;
    expiresAt: string;
    createdAt: string;
  }>;
  passkeyCount: number;
  totpCount: number;
};

type UserRow = {
  id: string;
  email: string | null;
  phone: string | null;
  tenant_id: string;
  time_joined: Date | string;
  email_verified?: boolean;
  metadata_json?: string;
  held_at?: Date | string | null;
  held_reason?: string | null;
  archived_at?: Date | string | null;
  archived_reason?: string | null;
};

function toIso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  return new Date(v).toISOString();
}

function statusOf(row: UserRow): BrivenEngineUserStatus {
  if (row.archived_at) return 'archived';
  if (row.held_at) return 'held';
  return 'active';
}

function mapSummary(u: UserRow): BrivenEngineUserSummary {
  return {
    id: u.id,
    emails: u.email ? [u.email] : [],
    phoneNumbers: u.phone ? [u.phone] : [],
    tenantId: u.tenant_id,
    timeJoined: new Date(u.time_joined).getTime(),
    status: statusOf(u),
    heldAt: toIso(u.held_at),
    heldReason: u.held_reason ?? null,
    archivedAt: toIso(u.archived_at),
    archivedReason: u.archived_reason ?? null,
    engine: 'briven-engine',
    storage: 'doltgres',
  };
}

export async function listBrivenEngineUsers(opts?: {
  limit?: number;
  paginationToken?: string;
  tenantId?: string;
}): Promise<{
  users: BrivenEngineUserSummary[];
  nextPaginationToken?: string;
  engine: 'briven-engine';
  storage: 'doltgres';
}> {
  if (!isAuthCoreInitialized()) {
    return { users: [], engine: 'briven-engine', storage: 'doltgres' };
  }
  const limit = opts?.limit ?? 50;
  const pool = getEnginePool();
  const res = opts?.tenantId
    ? await pool.query(
        `SELECT id, email, phone, tenant_id, time_joined,
                held_at, held_reason, archived_at, archived_reason
         FROM be_users
         WHERE tenant_id = $1
         ORDER BY time_joined DESC LIMIT $2`,
        [opts.tenantId, limit],
      )
    : await pool.query(
        `SELECT id, email, phone, tenant_id, time_joined,
                held_at, held_reason, archived_at, archived_reason
         FROM be_users
         ORDER BY time_joined DESC LIMIT $1`,
        [limit],
      );
  const users = (res.rows as UserRow[]).map(mapSummary);
  return { users, engine: 'briven-engine', storage: 'doltgres' };
}

export async function getBrivenEngineUser(
  userId: string,
  opts?: { tenantId?: string },
): Promise<BrivenEngineUserDetail | null> {
  if (!isAuthCoreInitialized()) return null;
  const pool = getEnginePool();
  const res = opts?.tenantId
    ? await pool.query(
        `SELECT id, email, phone, tenant_id, time_joined, email_verified, metadata_json,
                held_at, held_reason, archived_at, archived_reason
         FROM be_users WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [userId, opts.tenantId],
      )
    : await pool.query(
        `SELECT id, email, phone, tenant_id, time_joined, email_verified, metadata_json,
                held_at, held_reason, archived_at, archived_reason
         FROM be_users WHERE id = $1 LIMIT 1`,
        [userId],
      );
  const row = res.rows[0] as UserRow | undefined;
  if (!row) return null;

  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(row.metadata_json ?? '{}') as Record<string, unknown>;
  } catch {
    metadata = {};
  }

  const [rolesRes, linksRes, sessionsRes, passkeysRes, totpRes] =
    await Promise.all([
      pool.query(
        `SELECT role_name FROM be_user_roles WHERE user_id = $1 ORDER BY role_name`,
        [userId],
      ),
      pool.query(
        `SELECT id, third_party_id, third_party_user_id, created_at
         FROM be_third_party_links WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      ),
      pool.query(
        `SELECT session_handle, expires_at, created_at
         FROM be_sessions
         WHERE user_id = $1 AND expires_at > NOW()
         ORDER BY created_at DESC`,
        [userId],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM be_webauthn_credentials WHERE user_id = $1`,
        [userId],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM be_totp_devices WHERE user_id = $1 AND verified = TRUE`,
        [userId],
      ),
    ]);

  return {
    ...mapSummary(row),
    emailVerified: Boolean(row.email_verified),
    metadata,
    roles: (rolesRes.rows as Array<{ role_name: string }>).map((r) => r.role_name),
    linkedLogins: (
      linksRes.rows as Array<{
        id: string;
        third_party_id: string;
        third_party_user_id: string;
        created_at: Date | string;
      }>
    ).map((l) => ({
      id: l.id,
      provider: l.third_party_id,
      providerUserId: l.third_party_user_id,
      createdAt: new Date(l.created_at).toISOString(),
    })),
    sessions: (
      sessionsRes.rows as Array<{
        session_handle: string;
        expires_at: Date | string;
        created_at: Date | string;
      }>
    ).map((s) => ({
      handle: s.session_handle,
      expiresAt: new Date(s.expires_at).toISOString(),
      createdAt: new Date(s.created_at).toISOString(),
    })),
    passkeyCount: Number(
      (passkeysRes.rows[0] as { n?: number } | undefined)?.n ?? 0,
    ),
    totpCount: Number((totpRes.rows[0] as { n?: number } | undefined)?.n ?? 0),
  };
}

/**
 * Returns null when the user may use Auth. Otherwise a machine code for 403.
 * Held / archived users cannot sign in or keep using sessions.
 */
export async function getUserAccessBlock(
  userId: string,
): Promise<'held' | 'archived' | 'not_found' | null> {
  if (!isAuthCoreInitialized()) return null;
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT held_at, archived_at FROM be_users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const row = res.rows[0] as
    | { held_at: Date | string | null; archived_at: Date | string | null }
    | undefined;
  if (!row) return 'not_found';
  if (row.archived_at) return 'archived';
  if (row.held_at) return 'held';
  return null;
}

export async function getBrivenEngineUserMetadata(
  userId: string,
): Promise<Record<string, unknown> | null> {
  if (!isAuthCoreInitialized()) return null;
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT metadata_json FROM be_users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const row = res.rows[0] as { metadata_json: string } | undefined;
  if (!row) return {};
  try {
    return JSON.parse(row.metadata_json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function updateBrivenEngineUserMetadata(
  userId: string,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  if (!isAuthCoreInitialized()) return false;
  const pool = getEnginePool();
  const res = await pool.query(
    `UPDATE be_users SET metadata_json = $2 WHERE id = $1`,
    [userId, JSON.stringify(metadata)],
  );
  return (res.rowCount ?? 0) > 0;
}

async function assertUserInTenant(
  userId: string,
  tenantId?: string,
): Promise<boolean> {
  if (!tenantId) return true;
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT 1 FROM be_users WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [userId, tenantId],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Put account on hold — cannot sign in / use sessions; data kept. */
export async function holdBrivenEngineUser(
  userId: string,
  opts?: { reason?: string; tenantId?: string },
): Promise<boolean> {
  if (!isAuthCoreInitialized()) return false;
  if (!(await assertUserInTenant(userId, opts?.tenantId))) return false;
  const pool = getEnginePool();
  const res = await pool.query(
    `UPDATE be_users
     SET held_at = NOW(), held_reason = $2
     WHERE id = $1 AND archived_at IS NULL`,
    [userId, opts?.reason?.trim() || null],
  );
  const ok = (res.rowCount ?? 0) > 0;
  if (ok) {
    void recordBrivenEngineAudit({
      action: 'user.held',
      userId,
      tenantId: opts?.tenantId ?? null,
      metadata: { reason: opts?.reason ?? null },
    });
  }
  return ok;
}

export async function unholdBrivenEngineUser(
  userId: string,
  opts?: { tenantId?: string },
): Promise<boolean> {
  if (!isAuthCoreInitialized()) return false;
  if (!(await assertUserInTenant(userId, opts?.tenantId))) return false;
  const pool = getEnginePool();
  const res = await pool.query(
    `UPDATE be_users SET held_at = NULL, held_reason = NULL WHERE id = $1`,
    [userId],
  );
  const ok = (res.rowCount ?? 0) > 0;
  if (ok) {
    void recordBrivenEngineAudit({
      action: 'user.unheld',
      userId,
      tenantId: opts?.tenantId ?? null,
      metadata: {},
    });
  }
  return ok;
}

/** Archive — hidden/blocked, data kept, can restore. */
export async function archiveBrivenEngineUser(
  userId: string,
  opts?: { reason?: string; tenantId?: string },
): Promise<boolean> {
  if (!isAuthCoreInitialized()) return false;
  if (!(await assertUserInTenant(userId, opts?.tenantId))) return false;
  const pool = getEnginePool();
  const res = await pool.query(
    `UPDATE be_users
     SET archived_at = NOW(), archived_reason = $2,
         held_at = NULL, held_reason = NULL
     WHERE id = $1`,
    [userId, opts?.reason?.trim() || null],
  );
  const ok = (res.rowCount ?? 0) > 0;
  if (ok) {
    // Archived users should not keep live sessions.
    await revokeAllForUser(userId);
    void recordBrivenEngineAudit({
      action: 'user.archived',
      userId,
      tenantId: opts?.tenantId ?? null,
      metadata: { reason: opts?.reason ?? null },
    });
  }
  return ok;
}

export async function unarchiveBrivenEngineUser(
  userId: string,
  opts?: { tenantId?: string },
): Promise<boolean> {
  if (!isAuthCoreInitialized()) return false;
  if (!(await assertUserInTenant(userId, opts?.tenantId))) return false;
  const pool = getEnginePool();
  const res = await pool.query(
    `UPDATE be_users
     SET archived_at = NULL, archived_reason = NULL
     WHERE id = $1`,
    [userId],
  );
  const ok = (res.rowCount ?? 0) > 0;
  if (ok) {
    void recordBrivenEngineAudit({
      action: 'user.unarchived',
      userId,
      tenantId: opts?.tenantId ?? null,
      metadata: {},
    });
  }
  return ok;
}

/**
 * Hard delete — remove user + credentials + sessions + links.
 * Email becomes free for a new signup.
 */
export async function deleteBrivenEngineUser(
  userId: string,
  opts?: { tenantId?: string },
): Promise<boolean> {
  if (!isAuthCoreInitialized()) return false;
  if (!(await assertUserInTenant(userId, opts?.tenantId))) return false;
  const pool = getEnginePool();

  // Best-effort cascade (no FKs on all tables in Doltgres engine).
  await Promise.all([
    pool.query(`DELETE FROM be_sessions WHERE user_id = $1`, [userId]),
    pool.query(`DELETE FROM be_password_hashes WHERE user_id = $1`, [userId]),
    pool.query(`DELETE FROM be_third_party_links WHERE user_id = $1`, [userId]),
    pool.query(`DELETE FROM be_user_roles WHERE user_id = $1`, [userId]),
    pool.query(`DELETE FROM be_totp_devices WHERE user_id = $1`, [userId]),
    pool.query(`DELETE FROM be_webauthn_credentials WHERE user_id = $1`, [userId]),
    pool.query(`DELETE FROM be_webauthn_challenges WHERE user_id = $1`, [userId]),
    pool.query(`DELETE FROM be_oidc_consents WHERE user_id = $1`, [userId]),
  ]);

  const res = await pool.query(`DELETE FROM be_users WHERE id = $1`, [userId]);
  const ok = (res.rowCount ?? 0) > 0;
  if (ok) {
    void recordBrivenEngineAudit({
      action: 'user.deleted',
      userId,
      tenantId: opts?.tenantId ?? null,
      metadata: {},
    });
  }
  return ok;
}
