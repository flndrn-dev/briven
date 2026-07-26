/**
 * OIDC authorization code + PKCE + refresh flow (production IdP).
 */

import { createHash, randomBytes } from 'node:crypto';

import { SignJWT, jwtVerify, importJWK, type JWTPayload } from 'jose';

import { env } from '../../env.js';
import { getEnginePool } from './db.js';
import { ensureOidcSigningKey } from './idp-signing.js';
import {
  getOidcClientByClientId,
  redirectUriAllowed,
  type OidcClient,
  verifyOidcClientSecret,
} from './idp-clients.js';
import { recordBrivenEngineAudit } from './audit.js';

export const ACCESS_TOKEN_TTL = 3600; // 1h
export const REFRESH_TOKEN_TTL_DAYS = 30;
export const AUTH_CODE_TTL_SEC = 600; // 10m
export const AUTH_REQUEST_TTL_SEC = 900; // 15m

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Base64Url(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

export function oidcIssuer(): string {
  return `${env.BRIVEN_API_ORIGIN.replace(/\/$/, '')}/v1/auth-core/oidc`;
}

export function webOrigin(): string {
  return env.BRIVEN_WEB_ORIGIN.replace(/\/$/, '');
}

export type AuthRequest = {
  id: string;
  clientId: string;
  projectId: string;
  redirectUri: string;
  scope: string;
  state: string | null;
  nonce: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  userId: string | null;
  consentedAt: string | null;
  expiresAt: string;
};

function mapAuthReq(r: Record<string, unknown>): AuthRequest {
  return {
    id: String(r.id),
    clientId: String(r.client_id),
    projectId: String(r.project_id),
    redirectUri: String(r.redirect_uri),
    scope: String(r.scope),
    state: r.state ? String(r.state) : null,
    nonce: r.nonce ? String(r.nonce) : null,
    codeChallenge: r.code_challenge ? String(r.code_challenge) : null,
    codeChallengeMethod: r.code_challenge_method
      ? String(r.code_challenge_method)
      : null,
    userId: r.user_id ? String(r.user_id) : null,
    consentedAt: r.consented_at
      ? r.consented_at instanceof Date
        ? r.consented_at.toISOString()
        : String(r.consented_at)
      : null,
    expiresAt:
      r.expires_at instanceof Date
        ? r.expires_at.toISOString()
        : String(r.expires_at),
  };
}

export async function createAuthRequest(input: {
  client: OidcClient;
  redirectUri: string;
  scope: string;
  state?: string | null;
  nonce?: string | null;
  codeChallenge?: string | null;
  codeChallengeMethod?: string | null;
}): Promise<AuthRequest> {
  if (input.client.revokedAt) throw new Error('client_revoked');
  if (!redirectUriAllowed(input.client, input.redirectUri)) {
    throw new Error('invalid_redirect_uri');
  }
  if (input.client.isPublic) {
    if (!input.codeChallenge) throw new Error('pkce_required');
    const method = (input.codeChallengeMethod ?? 'S256').toUpperCase();
    if (method !== 'S256' && method !== 'PLAIN') {
      throw new Error('unsupported_code_challenge_method');
    }
  }

  const scopes = input.scope.split(/\s+/).filter(Boolean);
  if (!scopes.includes('openid')) {
    throw new Error('openid_scope_required');
  }
  for (const s of scopes) {
    if (!input.client.scopes.includes(s) && s !== 'openid') {
      // allow openid always; others must be registered on client
      if (!['profile', 'email', 'offline_access'].includes(s)) {
        throw new Error(`invalid_scope:${s}`);
      }
    }
  }

  const id = `oar_${randomBytes(16).toString('hex')}`;
  const expiresAt = new Date(Date.now() + AUTH_REQUEST_TTL_SEC * 1000);
  const pool = getEnginePool();
  await pool.query(
    `INSERT INTO be_oidc_auth_requests
      (id, client_id, project_id, redirect_uri, scope, state, nonce,
       code_challenge, code_challenge_method, response_type, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'code',$10)`,
    [
      id,
      input.client.clientId,
      input.client.projectId,
      input.redirectUri,
      scopes.join(' '),
      input.state ?? null,
      input.nonce ?? null,
      input.codeChallenge ?? null,
      input.codeChallengeMethod ?? null,
      expiresAt.toISOString(),
    ],
  );
  const req = await getAuthRequest(id);
  if (!req) throw new Error('auth_request_create_failed');
  return req;
}

export async function getAuthRequest(id: string): Promise<AuthRequest | null> {
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT * FROM be_oidc_auth_requests WHERE id = $1 LIMIT 1`,
    [id],
  );
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const req = mapAuthReq(row);
  if (new Date(req.expiresAt).getTime() < Date.now()) return null;
  return req;
}

export async function attachUserToAuthRequest(
  id: string,
  userId: string,
): Promise<AuthRequest | null> {
  const pool = getEnginePool();
  await pool.query(
    `UPDATE be_oidc_auth_requests SET user_id = $2 WHERE id = $1 AND user_id IS NULL`,
    [id, userId],
  );
  return getAuthRequest(id);
}

export async function hasConsent(
  userId: string,
  clientId: string,
  scope: string,
): Promise<boolean> {
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT scope FROM be_oidc_consents WHERE user_id = $1 AND client_id = $2 LIMIT 1`,
    [userId, clientId],
  );
  const row = res.rows[0] as { scope?: string } | undefined;
  if (!row?.scope) return false;
  const granted = new Set(row.scope.split(/\s+/));
  return scope.split(/\s+/).every((s) => granted.has(s));
}

export async function grantConsent(
  userId: string,
  clientId: string,
  scope: string,
): Promise<void> {
  const pool = getEnginePool();
  await pool.query(
    `INSERT INTO be_oidc_consents (user_id, client_id, scope, granted_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, client_id) DO UPDATE SET scope = $3, granted_at = NOW()`,
    [userId, clientId, scope],
  );
  void recordBrivenEngineAudit({
    action: 'oidc.consent.granted',
    userId,
    metadata: { clientId, scope },
  });
}

/** Issue authorization code after consent; returns redirect URL. */
export async function issueAuthCodeAndRedirect(
  requestId: string,
  userId: string,
): Promise<{ redirectUrl: string }> {
  const req = await getAuthRequest(requestId);
  if (!req) throw new Error('invalid_request');
  if (req.userId && req.userId !== userId) throw new Error('user_mismatch');

  const client = await getOidcClientByClientId(req.clientId);
  if (!client || client.revokedAt) throw new Error('invalid_client');

  await grantConsent(userId, req.clientId, req.scope);

  const code = `ac_${randomBytes(24).toString('base64url')}`;
  const codeHash = hash(code);
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SEC * 1000);
  const pool = getEnginePool();

  await pool.query(
    `INSERT INTO be_oidc_auth_codes
      (code_hash, client_id, project_id, user_id, redirect_uri, scope, nonce,
       code_challenge, code_challenge_method, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      codeHash,
      req.clientId,
      req.projectId,
      userId,
      req.redirectUri,
      req.scope,
      req.nonce,
      req.codeChallenge,
      req.codeChallengeMethod,
      expiresAt.toISOString(),
    ],
  );
  await pool.query(
    `UPDATE be_oidc_auth_requests SET user_id = $2, consented_at = NOW() WHERE id = $1`,
    [requestId, userId],
  );

  void recordBrivenEngineAudit({
    action: 'oidc.code.issued',
    projectId: req.projectId,
    userId,
    metadata: { clientId: req.clientId },
  });

  const url = new URL(req.redirectUri);
  url.searchParams.set('code', code);
  if (req.state) url.searchParams.set('state', req.state);
  return { redirectUrl: url.toString() };
}

export async function denyAuthRequest(
  requestId: string,
): Promise<{ redirectUrl: string }> {
  const req = await getAuthRequest(requestId);
  if (!req) throw new Error('invalid_request');
  const url = new URL(req.redirectUri);
  url.searchParams.set('error', 'access_denied');
  url.searchParams.set('error_description', 'user denied consent');
  if (req.state) url.searchParams.set('state', req.state);
  void recordBrivenEngineAudit({
    action: 'oidc.consent.denied',
    projectId: req.projectId,
    metadata: { clientId: req.clientId },
  });
  return { redirectUrl: url.toString() };
}

async function loadUserClaims(userId: string): Promise<{
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  projectId?: string;
  custom?: Record<string, string | number | boolean>;
}> {
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT id, email, email_verified, metadata_json, tenant_id FROM be_users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const row = res.rows[0] as
    | {
        id: string;
        email?: string | null;
        email_verified?: boolean;
        metadata_json?: string;
        tenant_id?: string;
      }
    | undefined;
  if (!row) return { sub: userId };
  let name: string | undefined;
  let preferred_username: string | undefined;
  let projectId: string | undefined;
  try {
    const meta = JSON.parse(row.metadata_json ?? '{}') as {
      name?: string;
      username?: string;
    };
    if (meta.name) name = meta.name;
    if (meta.username) preferred_username = meta.username;
  } catch {
    /* ignore */
  }
  // tenant_id often equals projectId for project-mapped tenants
  if (row.tenant_id?.startsWith('p_')) projectId = row.tenant_id;
  else if (row.tenant_id) {
    try {
      const t = await pool.query(
        `SELECT project_id FROM be_tenants WHERE tenant_id = $1 LIMIT 1`,
        [row.tenant_id],
      );
      const pid = (t.rows[0] as { project_id?: string } | undefined)?.project_id;
      if (pid) projectId = pid;
    } catch {
      /* ignore */
    }
  }
  let custom: Record<string, string | number | boolean> = {};
  if (projectId) {
    try {
      const { getBrivenEngineJwtClaims } = await import('./project-config.js');
      custom = await getBrivenEngineJwtClaims(projectId);
    } catch {
      custom = {};
    }
  }
  return {
    sub: row.id,
    email: row.email ?? undefined,
    email_verified: Boolean(row.email_verified),
    name,
    preferred_username,
    projectId,
    custom,
  };
}

async function signAccessAndIdToken(input: {
  client: OidcClient;
  userId: string;
  scope: string;
  nonce?: string | null;
}): Promise<{ accessToken: string; idToken: string; expiresIn: number }> {
  const key = await ensureOidcSigningKey();
  const claims = await loadUserClaims(input.userId);
  const issuer = oidcIssuer();
  const now = Math.floor(Date.now() / 1000);

  const accessToken = await new SignJWT({
    scope: input.scope,
    client_id: input.client.clientId,
    project_id: input.client.projectId,
    token_use: 'access',
  })
    .setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience(input.client.clientId)
    .setSubject(input.userId)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL)
    .setJti(`at_${randomBytes(8).toString('hex')}`)
    .sign(key.privateKey);

  const idPayload: Record<string, unknown> = {
    token_use: 'id',
  };
  if (input.scope.includes('email') && claims.email) {
    idPayload.email = claims.email;
    idPayload.email_verified = claims.email_verified ?? false;
  }
  if (input.scope.includes('profile')) {
    if (claims.name) idPayload.name = claims.name;
    if (claims.preferred_username) {
      idPayload.preferred_username = claims.preferred_username;
    }
  }
  // Project-level custom JWT claim templates (SuperTokens-class depth).
  if (claims.custom) {
    for (const [k, v] of Object.entries(claims.custom)) {
      if (k === 'sub' || k === 'iss' || k === 'aud' || k === 'exp' || k === 'iat') {
        continue;
      }
      idPayload[k] = v;
    }
  }
  if (input.nonce) idPayload.nonce = input.nonce;

  const idToken = await new SignJWT(idPayload)
    .setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience(input.client.clientId)
    .setSubject(input.userId)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL)
    .sign(key.privateKey);

  return { accessToken, idToken, expiresIn: ACCESS_TOKEN_TTL };
}

async function mintRefreshToken(input: {
  clientId: string;
  projectId: string;
  userId: string;
  scope: string;
}): Promise<string | null> {
  if (!input.scope.includes('offline_access')) return null;
  const raw = `rt_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(
    Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const pool = getEnginePool();
  await pool.query(
    `INSERT INTO be_oidc_refresh_tokens
      (token_hash, client_id, project_id, user_id, scope, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      hash(raw),
      input.clientId,
      input.projectId,
      input.userId,
      input.scope,
      expiresAt.toISOString(),
    ],
  );
  return raw;
}

function verifyPkce(
  method: string | null,
  challenge: string | null,
  verifier: string | null | undefined,
): boolean {
  if (!challenge) return true; // confidential may omit
  if (!verifier) return false;
  const m = (method ?? 'S256').toUpperCase();
  if (m === 'PLAIN') return verifier === challenge;
  if (m === 'S256') return sha256Base64Url(verifier) === challenge;
  return false;
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string | null;
  codeVerifier?: string | null;
}): Promise<
  | {
      ok: true;
      access_token: string;
      id_token: string;
      refresh_token?: string;
      token_type: 'Bearer';
      expires_in: number;
      scope: string;
    }
  | { ok: false; error: string; error_description: string }
> {
  const client = await getOidcClientByClientId(input.clientId);
  if (!client || client.revokedAt) {
    return {
      ok: false,
      error: 'invalid_client',
      error_description: 'unknown or revoked client',
    };
  }
  if (!(await verifyOidcClientSecret(client, input.clientSecret))) {
    return {
      ok: false,
      error: 'invalid_client',
      error_description: 'client authentication failed',
    };
  }

  const pool = getEnginePool();
  const codeHash = hash(input.code);
  const res = await pool.query(
    `SELECT * FROM be_oidc_auth_codes WHERE code_hash = $1 LIMIT 1`,
    [codeHash],
  );
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row || row.used_at) {
    return {
      ok: false,
      error: 'invalid_grant',
      error_description: 'code invalid or already used',
    };
  }
  if (String(row.client_id) !== input.clientId) {
    return {
      ok: false,
      error: 'invalid_grant',
      error_description: 'code client mismatch',
    };
  }
  if (String(row.redirect_uri) !== input.redirectUri) {
    return {
      ok: false,
      error: 'invalid_grant',
      error_description: 'redirect_uri mismatch',
    };
  }
  const exp = new Date(row.expires_at as string | Date);
  if (exp.getTime() < Date.now()) {
    return {
      ok: false,
      error: 'invalid_grant',
      error_description: 'code expired',
    };
  }

  const challenge = row.code_challenge ? String(row.code_challenge) : null;
  const method = row.code_challenge_method
    ? String(row.code_challenge_method)
    : null;
  if (client.isPublic || challenge) {
    if (!verifyPkce(method, challenge, input.codeVerifier)) {
      return {
        ok: false,
        error: 'invalid_grant',
        error_description: 'pkce verification failed',
      };
    }
  }

  await pool.query(
    `UPDATE be_oidc_auth_codes SET used_at = NOW() WHERE code_hash = $1`,
    [codeHash],
  );

  const userId = String(row.user_id);
  const scope = String(row.scope);
  const nonce = row.nonce ? String(row.nonce) : null;

  const tokens = await signAccessAndIdToken({
    client,
    userId,
    scope,
    nonce,
  });
  const refresh = await mintRefreshToken({
    clientId: client.clientId,
    projectId: client.projectId,
    userId,
    scope,
  });

  void recordBrivenEngineAudit({
    action: 'oidc.token.issued',
    projectId: client.projectId,
    userId,
    metadata: { clientId: client.clientId, grant: 'authorization_code' },
  });

  return {
    ok: true,
    access_token: tokens.accessToken,
    id_token: tokens.idToken,
    refresh_token: refresh ?? undefined,
    token_type: 'Bearer',
    expires_in: tokens.expiresIn,
    scope,
  };
}

export async function exchangeRefreshToken(input: {
  refreshToken: string;
  clientId: string;
  clientSecret?: string | null;
}): Promise<
  | {
      ok: true;
      access_token: string;
      id_token: string;
      refresh_token?: string;
      token_type: 'Bearer';
      expires_in: number;
      scope: string;
    }
  | { ok: false; error: string; error_description: string }
> {
  const client = await getOidcClientByClientId(input.clientId);
  if (!client || client.revokedAt) {
    return {
      ok: false,
      error: 'invalid_client',
      error_description: 'unknown or revoked client',
    };
  }
  if (!(await verifyOidcClientSecret(client, input.clientSecret))) {
    return {
      ok: false,
      error: 'invalid_client',
      error_description: 'client authentication failed',
    };
  }

  const pool = getEnginePool();
  const th = hash(input.refreshToken);
  const res = await pool.query(
    `SELECT * FROM be_oidc_refresh_tokens WHERE token_hash = $1 LIMIT 1`,
    [th],
  );
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row || row.revoked_at) {
    return {
      ok: false,
      error: 'invalid_grant',
      error_description: 'refresh token invalid',
    };
  }
  if (String(row.client_id) !== input.clientId) {
    return {
      ok: false,
      error: 'invalid_grant',
      error_description: 'refresh client mismatch',
    };
  }
  if (new Date(row.expires_at as string | Date).getTime() < Date.now()) {
    return {
      ok: false,
      error: 'invalid_grant',
      error_description: 'refresh token expired',
    };
  }

  // Rotate refresh token
  await pool.query(
    `UPDATE be_oidc_refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`,
    [th],
  );

  const userId = String(row.user_id);
  const scope = String(row.scope);
  const tokens = await signAccessAndIdToken({ client, userId, scope });
  const refresh = await mintRefreshToken({
    clientId: client.clientId,
    projectId: client.projectId,
    userId,
    scope,
  });

  void recordBrivenEngineAudit({
    action: 'oidc.token.issued',
    projectId: client.projectId,
    userId,
    metadata: { clientId: client.clientId, grant: 'refresh_token' },
  });

  return {
    ok: true,
    access_token: tokens.accessToken,
    id_token: tokens.idToken,
    refresh_token: refresh ?? undefined,
    token_type: 'Bearer',
    expires_in: tokens.expiresIn,
    scope,
  };
}

export type AccessTokenPayload = JWTPayload & {
  scope?: string;
  client_id?: string;
  project_id?: string;
  token_use?: string;
  sub: string;
};

export async function verifyOidcAccessToken(
  token: string,
): Promise<AccessTokenPayload> {
  const key = await ensureOidcSigningKey();
  const pub = await importJWK(key.publicJwk, 'RS256');
  const { payload } = await jwtVerify(token, pub, { issuer: oidcIssuer() });
  if (payload.token_use && payload.token_use !== 'access') {
    throw new Error('not_access_token');
  }
  if (typeof payload.sub !== 'string') throw new Error('missing_sub');
  return payload as AccessTokenPayload;
}

export async function buildUserInfo(accessToken: string): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; error: string }
> {
  try {
    const payload = await verifyOidcAccessToken(accessToken);
    const claims = await loadUserClaims(payload.sub);
    const scope = String(payload.scope ?? '');
    const body: Record<string, unknown> = { sub: claims.sub };
    if (scope.includes('email') && claims.email) {
      body.email = claims.email;
      body.email_verified = claims.email_verified ?? false;
    }
    if (scope.includes('profile') && claims.name) {
      body.name = claims.name;
    }
    return { ok: true, body };
  } catch {
    return { ok: false, status: 401, error: 'invalid_token' };
  }
}

export async function revokeToken(input: {
  token: string;
  clientId: string;
  clientSecret?: string | null;
}): Promise<{ ok: true }> {
  const client = await getOidcClientByClientId(input.clientId);
  if (!client) return { ok: true }; // RFC 7009: always 200
  if (!(await verifyOidcClientSecret(client, input.clientSecret))) {
    return { ok: true };
  }
  const pool = getEnginePool();
  await pool.query(
    `UPDATE be_oidc_refresh_tokens SET revoked_at = NOW()
     WHERE token_hash = $1 AND client_id = $2`,
    [hash(input.token), input.clientId],
  );
  void recordBrivenEngineAudit({
    action: 'oidc.token.revoked',
    projectId: client.projectId,
    metadata: { clientId: input.clientId },
  });
  return { ok: true };
}

export async function introspectToken(input: {
  token: string;
  clientId: string;
  clientSecret?: string | null;
}): Promise<Record<string, unknown>> {
  const client = await getOidcClientByClientId(input.clientId);
  if (!client || !(await verifyOidcClientSecret(client, input.clientSecret))) {
    return { active: false };
  }

  // Try as refresh
  const pool = getEnginePool();
  const th = hash(input.token);
  const rt = await pool.query(
    `SELECT * FROM be_oidc_refresh_tokens WHERE token_hash = $1 LIMIT 1`,
    [th],
  );
  const rrow = rt.rows[0] as Record<string, unknown> | undefined;
  if (rrow && !rrow.revoked_at) {
    const exp = new Date(rrow.expires_at as string | Date);
    if (exp.getTime() > Date.now() && String(rrow.client_id) === input.clientId) {
      return {
        active: true,
        token_type: 'refresh_token',
        client_id: input.clientId,
        sub: String(rrow.user_id),
        scope: String(rrow.scope),
        exp: Math.floor(exp.getTime() / 1000),
      };
    }
  }

  try {
    const payload = await verifyOidcAccessToken(input.token);
    if (payload.client_id && payload.client_id !== input.clientId) {
      return { active: false };
    }
    return {
      active: true,
      token_type: 'access_token',
      client_id: payload.client_id ?? input.clientId,
      sub: payload.sub,
      scope: payload.scope,
      exp: payload.exp,
      iat: payload.iat,
      iss: payload.iss,
    };
  } catch {
    return { active: false };
  }
}

export function discoveryDocument(): Record<string, unknown> {
  const iss = oidcIssuer();
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/authorize`,
    token_endpoint: `${iss}/token`,
    userinfo_endpoint: `${iss}/userinfo`,
    jwks_uri: `${iss}/jwks.json`,
    revocation_endpoint: `${iss}/revoke`,
    introspection_endpoint: `${iss}/introspect`,
    end_session_endpoint: `${iss}/end_session`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: [
      'client_secret_post',
      'client_secret_basic',
      'none',
    ],
    code_challenge_methods_supported: ['S256', 'plain'],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    claims_supported: [
      'sub',
      'iss',
      'aud',
      'exp',
      'iat',
      'email',
      'email_verified',
      'name',
      'nonce',
    ],
    request_parameter_supported: false,
    engine: 'briven-engine',
  };
}

