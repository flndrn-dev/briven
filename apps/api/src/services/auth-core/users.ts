/**
 * briven-engine users on Doltgres.
 */

import { getEnginePool } from './db.js';
import { isAuthCoreInitialized } from './engine.js';

export type BrivenEngineUserSummary = {
  id: string;
  emails: string[];
  phoneNumbers: string[];
  tenantId: string;
  timeJoined: number;
  engine: 'briven-engine';
  storage: 'doltgres';
};

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
        `SELECT id, email, phone, tenant_id, time_joined FROM be_users
         WHERE tenant_id = $1
         ORDER BY time_joined DESC LIMIT $2`,
        [opts.tenantId, limit],
      )
    : await pool.query(
        `SELECT id, email, phone, tenant_id, time_joined FROM be_users
         ORDER BY time_joined DESC LIMIT $1`,
        [limit],
      );
  const users: BrivenEngineUserSummary[] = res.rows.map(
    (u: {
      id: string;
      email: string | null;
      phone: string | null;
      tenant_id: string;
      time_joined: Date | string;
    }) => ({
      id: u.id,
      emails: u.email ? [u.email] : [],
      phoneNumbers: u.phone ? [u.phone] : [],
      tenantId: u.tenant_id,
      timeJoined: new Date(u.time_joined).getTime(),
      engine: 'briven-engine' as const,
      storage: 'doltgres' as const,
    }),
  );
  return { users, engine: 'briven-engine', storage: 'doltgres' };
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
