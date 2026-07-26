/**
 * briven-engine EmailPassword on Doltgres only.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { newId } from '@briven/shared';

import { getEnginePool } from './db.js';
import { projectIdToTenantId } from './project-map.js';

/** Exported for unit tests. Format: saltHex:scryptHex */
export function hashPassword(
  password: string,
  salt?: string,
): { hash: string; salt: string } {
  const s = salt ?? randomBytes(16).toString('hex');
  const derived = scryptSync(password, s, 64).toString('hex');
  return { hash: `${s}:${derived}`, salt: s };
}

/** Exported for unit tests. Constant-time compare. */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export type SignUpResult =
  | { status: 'OK'; user: { id: string; email: string; tenantId: string } }
  | { status: 'EMAIL_ALREADY_EXISTS_ERROR' };

export type SignInResult =
  | { status: 'OK'; user: { id: string; email: string; tenantId: string } }
  | { status: 'WRONG_CREDENTIALS_ERROR' };

export async function signUpEmailPassword(input: {
  email: string;
  password: string;
  tenantId?: string;
  projectId?: string;
  /** Optional username (stored in metadata; enables username login when project flag on). */
  username?: string;
}): Promise<SignUpResult> {
  const tenantId =
    input.tenantId ??
    (input.projectId ? projectIdToTenantId(input.projectId) : 'public');
  const email = input.email.trim().toLowerCase();
  const username = input.username?.trim().toLowerCase() || null;
  if (username && !/^[a-z0-9_]{3,32}$/.test(username)) {
    throw new Error('username must be 3–32 chars: a-z, 0-9, underscore');
  }
  const pool = getEnginePool();

  const existing = await pool.query(
    `SELECT id FROM be_users WHERE tenant_id = $1 AND email = $2 LIMIT 1`,
    [tenantId, email],
  );
  if (existing.rowCount && existing.rowCount > 0) {
    return { status: 'EMAIL_ALREADY_EXISTS_ERROR' };
  }

  const userId = newId('beu');
  const { hash } = hashPassword(input.password);

  // Doltgres: avoid relying on ON CONFLICT — probe first.
  const ten = await pool.query(
    `SELECT tenant_id FROM be_tenants WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  if (!ten.rowCount) {
    await pool.query(
      `INSERT INTO be_tenants (tenant_id, project_id) VALUES ($1, $2)`,
      [tenantId, input.projectId ?? tenantId],
    );
  }

  const metadata = username ? JSON.stringify({ username }) : '{}';
  await pool.query(
    `INSERT INTO be_users (id, tenant_id, email, email_verified, metadata_json)
     VALUES ($1, $2, $3, FALSE, $4)`,
    [userId, tenantId, email, metadata],
  );
  await pool.query(
    `INSERT INTO be_password_hashes (user_id, password_hash) VALUES ($1, $2)`,
    [userId, hash],
  );

  const { recordBrivenEngineAudit } = await import('./audit.js');
  void recordBrivenEngineAudit({
    action: 'signup.password',
    tenantId,
    projectId: input.projectId,
    userId,
    metadata: { email },
  });

  return {
    status: 'OK',
    user: { id: userId, email, tenantId },
  };
}

export async function signInEmailPassword(input: {
  email: string;
  password: string;
  tenantId?: string;
  projectId?: string;
  /**
   * When true (or project flag usernameLogin), `email` field may be a username
   * stored in metadata_json.username.
   */
  allowUsername?: boolean;
}): Promise<SignInResult> {
  const tenantId =
    input.tenantId ??
    (input.projectId ? projectIdToTenantId(input.projectId) : 'public');
  const login = input.email.trim().toLowerCase();
  const pool = getEnginePool();

  let allowUsername = Boolean(input.allowUsername);
  if (!allowUsername && input.projectId) {
    try {
      const { getBrivenEngineUsernameLogin } = await import('./project-config.js');
      allowUsername = await getBrivenEngineUsernameLogin(input.projectId);
    } catch {
      allowUsername = false;
    }
  }

  // Prefer exact email match; optional username via metadata (Doltgres-safe LIKE).
  let res = await pool.query(
    `SELECT u.id, u.email, u.tenant_id, p.password_hash
     FROM be_users u
     JOIN be_password_hashes p ON p.user_id = u.id
     WHERE u.tenant_id = $1 AND u.email = $2
     LIMIT 1`,
    [tenantId, login],
  );
  if ((!res.rowCount || res.rowCount === 0) && allowUsername) {
    res = await pool.query(
      `SELECT u.id, u.email, u.tenant_id, p.password_hash
       FROM be_users u
       JOIN be_password_hashes p ON p.user_id = u.id
       WHERE u.tenant_id = $1
         AND u.metadata_json LIKE $2
       LIMIT 1`,
      [tenantId, `%"username":"${login}"%`],
    );
  }
  const row = res.rows[0] as
    | { id: string; email: string; tenant_id: string; password_hash: string }
    | undefined;
  if (!row || !verifyPassword(input.password, row.password_hash)) {
    const { recordBrivenEngineAudit } = await import('./audit.js');
    void recordBrivenEngineAudit({
      action: 'signin.password.fail',
      tenantId,
      projectId: input.projectId,
      metadata: { login },
    });
    return { status: 'WRONG_CREDENTIALS_ERROR' };
  }
  const { recordBrivenEngineAudit } = await import('./audit.js');
  void recordBrivenEngineAudit({
    action: 'signin.password',
    tenantId: row.tenant_id,
    projectId: input.projectId,
    userId: row.id,
    metadata: { email: row.email },
  });
  return {
    status: 'OK',
    user: { id: row.id, email: row.email, tenantId: row.tenant_id },
  };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
