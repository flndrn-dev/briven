/**
 * OIDC client registry (per Briven project) — production IdP apps.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { getEnginePool } from './db.js';
import { mapProjectToAuthCore } from './project-map.js';
import { recordBrivenEngineAudit } from './audit.js';

export type OidcClient = {
  id: string;
  clientId: string;
  projectId: string;
  tenantId: string;
  name: string;
  logoUrl: string | null;
  isPublic: boolean;
  redirectUris: string[];
  postLogoutUris: string[];
  grantTypes: string[];
  scopes: string[];
  tokenEndpointAuthMethod: string;
  secretSuffix: string | null;
  revokedAt: string | null;
  createdAt: string;
};

function hashSecret(secret: string): string {
  return createHash('sha256').update(`briven-oidc-client:${secret}`).digest('hex');
}

function parseJsonArray(raw: unknown, fallback: string[]): string[] {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(v)) return fallback;
    return v.map(String).filter(Boolean);
  } catch {
    return fallback;
  }
}

function mapRow(r: Record<string, unknown>): OidcClient {
  return {
    id: String(r.id),
    clientId: String(r.client_id),
    projectId: String(r.project_id),
    tenantId: String(r.tenant_id),
    name: String(r.name),
    logoUrl: r.logo_url ? String(r.logo_url) : null,
    isPublic: Boolean(r.is_public),
    redirectUris: parseJsonArray(r.redirect_uris_json, []),
    postLogoutUris: parseJsonArray(r.post_logout_uris_json, []),
    grantTypes: parseJsonArray(r.grant_types_json, [
      'authorization_code',
      'refresh_token',
    ]),
    scopes: parseJsonArray(r.scopes_json, [
      'openid',
      'profile',
      'email',
      'offline_access',
    ]),
    tokenEndpointAuthMethod: String(
      r.token_endpoint_auth_method ?? 'client_secret_post',
    ),
    secretSuffix: r.client_secret_suffix ? String(r.client_secret_suffix) : null,
    revokedAt: r.revoked_at
      ? r.revoked_at instanceof Date
        ? r.revoked_at.toISOString()
        : String(r.revoked_at)
      : null,
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at ?? new Date().toISOString()),
  };
}

export function redirectUriAllowed(client: OidcClient, uri: string): boolean {
  return client.redirectUris.includes(uri);
}

export async function createOidcClient(input: {
  projectId: string;
  name: string;
  redirectUris: string[];
  logoUrl?: string | null;
  isPublic?: boolean;
  postLogoutUris?: string[];
  scopes?: string[];
  createdBy?: string | null;
}): Promise<{ client: OidcClient; clientSecret: string | null }> {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error('name must be 1–120 characters');
  const redirectUris = (input.redirectUris ?? [])
    .map((u) => u.trim())
    .filter(Boolean);
  if (redirectUris.length === 0) throw new Error('at least one redirect_uri required');
  for (const u of redirectUris) {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      throw new Error(`invalid redirect_uri: ${u}`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`redirect_uri must be http(s): ${u}`);
    }
    if (
      parsed.protocol === 'http:' &&
      parsed.hostname !== 'localhost' &&
      parsed.hostname !== '127.0.0.1'
    ) {
      throw new Error(`http redirect_uri only allowed on localhost: ${u}`);
    }
  }

  const isPublic = Boolean(input.isPublic);
  const map = mapProjectToAuthCore(input.projectId);
  const id = `oidc_${randomBytes(10).toString('hex')}`;
  const clientId = `oidc_app_${randomBytes(12).toString('base64url')}`;
  let clientSecret: string | null = null;
  let secretHash: string | null = null;
  let secretSuffix: string | null = null;
  if (!isPublic) {
    clientSecret = `oidc_sec_${randomBytes(24).toString('base64url')}`;
    secretHash = hashSecret(clientSecret);
    secretSuffix = clientSecret.slice(-4);
  }

  const postLogout = (input.postLogoutUris ?? []).map((u) => u.trim()).filter(Boolean);
  const scopes = input.scopes?.length
    ? input.scopes
    : ['openid', 'profile', 'email', 'offline_access'];
  let logoUrl: string | null = null;
  if (input.logoUrl?.trim()) {
    const lu = input.logoUrl.trim();
    if (lu.startsWith('https://') || lu.startsWith('http://localhost')) {
      logoUrl = lu.slice(0, 500);
    }
  }

  const pool = getEnginePool();
  await pool.query(
    `INSERT INTO be_oidc_clients
      (id, client_id, project_id, tenant_id, name, logo_url, client_secret_hash,
       client_secret_suffix, is_public, redirect_uris_json, post_logout_uris_json,
       grant_types_json, scopes_json, token_endpoint_auth_method, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())`,
    [
      id,
      clientId,
      input.projectId,
      map.tenantId,
      name,
      logoUrl,
      secretHash,
      secretSuffix,
      isPublic,
      JSON.stringify(redirectUris),
      JSON.stringify(postLogout),
      JSON.stringify(['authorization_code', 'refresh_token']),
      JSON.stringify(scopes),
      isPublic ? 'none' : 'client_secret_post',
      input.createdBy ?? null,
    ],
  );

  void recordBrivenEngineAudit({
    action: 'oidc.client.created',
    projectId: input.projectId,
    tenantId: map.tenantId,
    userId: input.createdBy ?? null,
    metadata: { clientId, name, isPublic },
  });

  const client = await getOidcClientByClientId(clientId);
  if (!client) throw new Error('client create failed');
  return { client, clientSecret };
}

export async function listOidcClients(projectId: string): Promise<OidcClient[]> {
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT * FROM be_oidc_clients WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId],
  );
  return (res.rows as Array<Record<string, unknown>>).map(mapRow);
}

export async function getOidcClientByClientId(
  clientId: string,
): Promise<OidcClient | null> {
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT * FROM be_oidc_clients WHERE client_id = $1 LIMIT 1`,
    [clientId],
  );
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapRow(row);
}

export async function revokeOidcClient(
  projectId: string,
  clientId: string,
): Promise<void> {
  const pool = getEnginePool();
  const res = await pool.query(
    `UPDATE be_oidc_clients SET revoked_at = NOW()
     WHERE project_id = $1 AND client_id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [projectId, clientId],
  );
  if (res.rowCount === 0) throw new Error('client not found or already revoked');
  void recordBrivenEngineAudit({
    action: 'oidc.client.revoked',
    projectId,
    metadata: { clientId },
  });
}

/** Verify confidential client secret (constant-time). Public clients: secret ignored. */
export async function verifyOidcClientSecret(
  client: OidcClient,
  secret: string | null | undefined,
): Promise<boolean> {
  if (client.isPublic) return true;
  if (client.revokedAt) return false;
  if (!secret) return false;
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT client_secret_hash FROM be_oidc_clients WHERE client_id = $1 LIMIT 1`,
    [client.clientId],
  );
  const row = res.rows[0] as { client_secret_hash?: string } | undefined;
  const expected = row?.client_secret_hash;
  if (!expected) return false;
  const got = hashSecret(secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(got, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
