/**
 * briven-engine M2M (machine-to-machine) client credentials.
 *
 * Operators create a client id + secret for a project. Machines exchange that
 * for a short-lived JWT (OAuth2 client_credentials). The JWT is accepted by
 * project data-plane auth (requireProjectAuth) for that project only.
 *
 * Secrets: shown once at create; only SHA-256 hash stored.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

import { env } from '../../env.js';
import { getEnginePool } from './db.js';
import { mapProjectToAuthCore } from './project-map.js';
import { recordBrivenEngineAudit } from './audit.js';

export type M2mRole = 'viewer' | 'developer' | 'admin';

export type M2mClientRow = {
  id: string;
  clientId: string;
  projectId: string;
  tenantId: string;
  name: string;
  secretSuffix: string;
  role: M2mRole;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type CreatedM2mClient = {
  client: M2mClientRow;
  /** Returned only once at create. */
  clientSecret: string;
};

const CLIENT_PREFIX = 'm2m_';
const SECRET_PREFIX = 'm2ms_';
const JWT_ISSUER = 'briven-api';
const JWT_AUDIENCE = 'briven-m2m';
/** Access token lifetime (seconds). */
export const M2M_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

const ROLES: readonly M2mRole[] = ['viewer', 'developer', 'admin'];

export function isM2mRole(v: string): v is M2mRole {
  return (ROLES as readonly string[]).includes(v);
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(`briven-m2m:${secret}`).digest('hex');
}

function secretBytes(): Uint8Array {
  const secret = env.BRIVEN_BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      'BRIVEN_BETTER_AUTH_SECRET is not set — refusing to sign/verify M2M tokens',
    );
  }
  return new TextEncoder().encode(secret);
}

function iso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function mapRow(r: Record<string, unknown>): M2mClientRow {
  return {
    id: String(r.id),
    clientId: String(r.client_id),
    projectId: String(r.project_id),
    tenantId: String(r.tenant_id),
    name: String(r.name),
    secretSuffix: String(r.secret_suffix),
    role: (isM2mRole(String(r.role)) ? String(r.role) : 'developer') as M2mRole,
    revokedAt: iso(r.revoked_at),
    lastUsedAt: iso(r.last_used_at),
    createdBy: r.created_by ? String(r.created_by) : null,
    createdAt: iso(r.created_at) ?? new Date().toISOString(),
  };
}

export async function createM2mClient(input: {
  projectId: string;
  name: string;
  role?: M2mRole;
  createdBy?: string | null;
}): Promise<CreatedM2mClient> {
  const name = input.name.trim();
  if (!name || name.length > 80) {
    throw new Error('name must be 1–80 characters');
  }
  const role: M2mRole = input.role && isM2mRole(input.role) ? input.role : 'developer';
  const map = mapProjectToAuthCore(input.projectId);
  const id = `bmc_${randomBytes(10).toString('hex')}`;
  const clientId = `${CLIENT_PREFIX}${randomBytes(12).toString('base64url')}`;
  const clientSecret = `${SECRET_PREFIX}${randomBytes(24).toString('base64url')}`;
  const secretHash = hashSecret(clientSecret);
  const secretSuffix = clientSecret.slice(-4);

  const pool = getEnginePool();
  await pool.query(
    `INSERT INTO be_m2m_clients
      (id, client_id, project_id, tenant_id, name, secret_hash, secret_suffix, role, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
    [
      id,
      clientId,
      input.projectId,
      map.tenantId,
      name,
      secretHash,
      secretSuffix,
      role,
      input.createdBy ?? null,
    ],
  );

  void recordBrivenEngineAudit({
    action: 'm2m.client.created',
    projectId: input.projectId,
    tenantId: map.tenantId,
    userId: input.createdBy ?? null,
    metadata: { clientId, role, name },
  });

  const client: M2mClientRow = {
    id,
    clientId,
    projectId: input.projectId,
    tenantId: map.tenantId,
    name,
    secretSuffix,
    role,
    revokedAt: null,
    lastUsedAt: null,
    createdBy: input.createdBy ?? null,
    createdAt: new Date().toISOString(),
  };

  return { client, clientSecret };
}

export async function listM2mClients(
  projectId: string,
): Promise<M2mClientRow[]> {
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT id, client_id, project_id, tenant_id, name, secret_suffix, role,
            revoked_at, last_used_at, created_by, created_at
     FROM be_m2m_clients
     WHERE project_id = $1
     ORDER BY created_at DESC`,
    [projectId],
  );
  return (res.rows as Array<Record<string, unknown>>).map(mapRow);
}

export async function revokeM2mClient(
  projectId: string,
  clientId: string,
): Promise<{ ok: true }> {
  const pool = getEnginePool();
  const res = await pool.query(
    `UPDATE be_m2m_clients
     SET revoked_at = NOW()
     WHERE project_id = $1 AND client_id = $2 AND revoked_at IS NULL
     RETURNING id, client_id`,
    [projectId, clientId],
  );
  if (res.rowCount === 0) {
    throw new Error('client not found or already revoked');
  }
  void recordBrivenEngineAudit({
    action: 'm2m.client.revoked',
    projectId,
    metadata: { clientId },
  });
  return { ok: true };
}

export type M2mTokenPayload = JWTPayload & {
  scope: 'm2m';
  project_id: string;
  role: M2mRole;
  client_id: string;
  sub: string;
};

export async function signM2mAccessToken(input: {
  clientId: string;
  projectId: string;
  role: M2mRole;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const accessToken = await new SignJWT({
    scope: 'm2m',
    project_id: input.projectId,
    role: input.role,
    client_id: input.clientId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(input.clientId)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${M2M_TOKEN_TTL_SECONDS}s`)
    .sign(secretBytes());

  return { accessToken, expiresIn: M2M_TOKEN_TTL_SECONDS };
}

export async function verifyM2mAccessToken(
  token: string,
): Promise<M2mTokenPayload> {
  const { payload } = await jwtVerify(token, secretBytes(), {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
  if (payload.scope !== 'm2m') {
    throw new Error('m2m-jwt: wrong scope');
  }
  if (typeof payload.project_id !== 'string' || !payload.project_id) {
    throw new Error('m2m-jwt: missing project_id');
  }
  if (typeof payload.client_id !== 'string' || !payload.client_id) {
    throw new Error('m2m-jwt: missing client_id');
  }
  const role = String(payload.role ?? '');
  if (!isM2mRole(role)) {
    throw new Error('m2m-jwt: invalid role');
  }
  if (typeof payload.sub !== 'string') {
    throw new Error('m2m-jwt: missing sub');
  }
  return payload as M2mTokenPayload;
}

/**
 * OAuth2 client_credentials: validate secret, mint access token.
 */
export async function issueM2mToken(input: {
  clientId: string;
  clientSecret: string;
}): Promise<
  | {
      ok: true;
      accessToken: string;
      tokenType: 'Bearer';
      expiresIn: number;
      projectId: string;
      clientId: string;
      role: M2mRole;
    }
  | { ok: false; code: string; message: string }
> {
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      code: 'invalid_client',
      message: 'client_id and client_secret required',
    };
  }

  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT id, client_id, project_id, tenant_id, name, secret_hash, role, revoked_at
     FROM be_m2m_clients
     WHERE client_id = $1
     LIMIT 1`,
    [clientId],
  );
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    void recordBrivenEngineAudit({
      action: 'm2m.token.fail',
      metadata: { clientId, reason: 'unknown_client' },
    });
    return {
      ok: false,
      code: 'invalid_client',
      message: 'unknown client',
    };
  }
  if (row.revoked_at) {
    void recordBrivenEngineAudit({
      action: 'm2m.token.fail',
      projectId: String(row.project_id),
      metadata: { clientId, reason: 'revoked' },
    });
    return {
      ok: false,
      code: 'invalid_client',
      message: 'client revoked',
    };
  }

  const expected = String(row.secret_hash);
  const got = hashSecret(clientSecret);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const gotBuf = Buffer.from(got, 'utf8');
  const secretOk =
    expectedBuf.length === gotBuf.length &&
    timingSafeEqual(expectedBuf, gotBuf);
  if (!secretOk) {
    void recordBrivenEngineAudit({
      action: 'm2m.token.fail',
      projectId: String(row.project_id),
      metadata: { clientId, reason: 'bad_secret' },
    });
    return {
      ok: false,
      code: 'invalid_client',
      message: 'invalid client credentials',
    };
  }

  const role = (isM2mRole(String(row.role)) ? String(row.role) : 'developer') as M2mRole;
  const projectId = String(row.project_id);
  const { accessToken, expiresIn } = await signM2mAccessToken({
    clientId,
    projectId,
    role,
  });

  await pool.query(
    `UPDATE be_m2m_clients SET last_used_at = NOW() WHERE client_id = $1`,
    [clientId],
  );

  void recordBrivenEngineAudit({
    action: 'm2m.token.issued',
    projectId,
    metadata: { clientId, role, expiresIn },
  });

  return {
    ok: true,
    accessToken,
    tokenType: 'Bearer',
    expiresIn,
    projectId,
    clientId,
    role,
  };
}
