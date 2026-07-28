/**
 * briven-engine enterprise SSO (SAML 2.0 + OIDC) on Doltgres.
 *
 * Connections live in be_sso_connections (not per-project Better Auth tables).
 * Successful login creates be_users + be_sessions like other FDI methods.
 */

import { createHash, randomBytes } from 'node:crypto';

import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import { newId } from '@briven/shared';

import { env } from '../../env.js';
import { log } from '../../lib/logger.js';
import { getEnginePool } from './db.js';
import { isAuthCoreInitialized } from './engine.js';
import { createEngineSession } from './native-session.js';
import { projectIdToTenantId } from './project-map.js';

export type SsoProviderType = 'saml' | 'oidc';

export type SamlConfig = {
  idpSsoUrl?: string;
  idpCert?: string;
  idpLogoutUrl?: string;
  idpMetadataXml?: string;
  idpMetadataUrl?: string;
  spEntityId?: string;
};

export type OidcConfig = {
  issuer?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userinfoUrl?: string;
  clientId?: string;
  /** Optional if stored encrypted separately later */
  clientSecret?: string;
  scopes?: string;
};

export type SsoConnection = {
  id: string;
  projectId: string;
  tenantId: string;
  name: string;
  providerType: SsoProviderType;
  domains: string[];
  config: Record<string, unknown>;
  jitEnabled: boolean;
  deactivatedAt: string | null;
  createdAt: string;
  /** True when required IdP fields are present for login */
  ready: boolean;
};

function parseJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function isSamlReady(config: SamlConfig): boolean {
  return Boolean(config.idpSsoUrl?.trim() && config.idpCert?.trim());
}

function isOidcReady(config: OidcConfig): boolean {
  return Boolean(
    config.clientId?.trim() &&
      config.clientSecret?.trim() &&
      (config.authorizationUrl?.trim() || config.issuer?.trim()) &&
      (config.tokenUrl?.trim() || config.issuer?.trim()),
  );
}

function connectionReady(
  providerType: SsoProviderType,
  config: Record<string, unknown>,
): boolean {
  if (providerType === 'saml') return isSamlReady(config as SamlConfig);
  return isOidcReady(config as OidcConfig);
}

function mapRow(r: {
  id: string;
  project_id: string;
  tenant_id: string;
  name: string;
  provider_type: string;
  domains_json: string;
  config_json: string;
  jit_enabled: boolean;
  deactivated_at: Date | string | null;
  created_at: Date | string;
}): SsoConnection {
  const config = parseJsonObject(r.config_json);
  const providerType = r.provider_type as SsoProviderType;
  return {
    id: r.id,
    projectId: r.project_id,
    tenantId: r.tenant_id,
    name: r.name,
    providerType,
    domains: parseJsonArray(r.domains_json),
    config,
    jitEnabled: Boolean(r.jit_enabled),
    deactivatedAt: r.deactivated_at
      ? new Date(r.deactivated_at).toISOString()
      : null,
    createdAt: new Date(r.created_at).toISOString(),
    ready: connectionReady(providerType, config),
  };
}

async function ensureTenant(projectId: string): Promise<string> {
  const tenantId = projectIdToTenantId(projectId);
  const pool = getEnginePool();
  const existing = await pool.query(
    `SELECT tenant_id FROM be_tenants WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  if (!existing.rowCount) {
    await pool.query(
      `INSERT INTO be_tenants (tenant_id, project_id) VALUES ($1, $2)`,
      [tenantId, projectId],
    );
  }
  return tenantId;
}

export async function listEngineSsoConnections(
  projectId: string,
): Promise<SsoConnection[]> {
  if (!isAuthCoreInitialized()) return [];
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT * FROM be_sso_connections
     WHERE project_id = $1 AND deactivated_at IS NULL
     ORDER BY created_at`,
    [projectId],
  );
  return (res.rows as Parameters<typeof mapRow>[0][]).map(mapRow);
}

export async function getEngineSsoConnection(
  connectionId: string,
): Promise<SsoConnection | null> {
  if (!isAuthCoreInitialized()) return null;
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT * FROM be_sso_connections WHERE id = $1 LIMIT 1`,
    [connectionId],
  );
  const row = res.rows[0] as Parameters<typeof mapRow>[0] | undefined;
  return row ? mapRow(row) : null;
}

export async function createEngineSsoConnection(input: {
  projectId: string;
  name: string;
  providerType: SsoProviderType;
  domains?: string[];
  config?: Record<string, unknown>;
  jitEnabled?: boolean;
}): Promise<SsoConnection> {
  if (!isAuthCoreInitialized()) {
    throw new Error('engine not ready');
  }
  const name = input.name.trim();
  if (!name) throw new Error('name required');
  if (!['saml', 'oidc'].includes(input.providerType)) {
    throw new Error('providerType must be saml or oidc');
  }
  const tenantId = await ensureTenant(input.projectId);
  const id = newId('bsc');
  const domains = (input.domains ?? [])
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const config = input.config ?? {};
  const pool = getEnginePool();
  await pool.query(
    `INSERT INTO be_sso_connections
      (id, project_id, tenant_id, name, provider_type, domains_json, config_json, jit_enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      input.projectId,
      tenantId,
      name,
      input.providerType,
      JSON.stringify(domains),
      JSON.stringify(config),
      input.jitEnabled ?? true,
    ],
  );
  const created = await getEngineSsoConnection(id);
  if (!created) throw new Error('create failed');
  log.info('briven_engine_sso_connection_created', {
    id,
    projectId: input.projectId,
    providerType: input.providerType,
    ready: created.ready,
  });
  return created;
}

export async function updateEngineSsoConnection(
  connectionId: string,
  patch: {
    name?: string;
    domains?: string[];
    config?: Record<string, unknown>;
    jitEnabled?: boolean;
  },
): Promise<SsoConnection | null> {
  const existing = await getEngineSsoConnection(connectionId);
  if (!existing || existing.deactivatedAt) return null;
  const name = patch.name?.trim() || existing.name;
  const domains =
    patch.domains?.map((d) => d.trim().toLowerCase()).filter(Boolean) ??
    existing.domains;
  const config = patch.config
    ? { ...existing.config, ...patch.config }
    : existing.config;
  const jitEnabled = patch.jitEnabled ?? existing.jitEnabled;
  const pool = getEnginePool();
  await pool.query(
    `UPDATE be_sso_connections
     SET name = $2, domains_json = $3, config_json = $4, jit_enabled = $5
     WHERE id = $1`,
    [
      connectionId,
      name,
      JSON.stringify(domains),
      JSON.stringify(config),
      jitEnabled,
    ],
  );
  return getEngineSsoConnection(connectionId);
}

export async function deactivateEngineSsoConnection(
  connectionId: string,
): Promise<boolean> {
  if (!isAuthCoreInitialized()) return false;
  const pool = getEnginePool();
  const res = await pool.query(
    `UPDATE be_sso_connections SET deactivated_at = NOW()
     WHERE id = $1 AND deactivated_at IS NULL`,
    [connectionId],
  );
  return (res.rowCount ?? 0) > 0;
}

function acsUrl(connectionId: string): string {
  return `${env.BRIVEN_API_ORIGIN}/v1/auth-core/sso/saml/${connectionId}/acs`;
}

function spEntityId(projectId: string, connectionId: string): string {
  return `${env.BRIVEN_API_ORIGIN}/sso/${projectId}/${connectionId}`;
}

function buildSaml(conn: SsoConnection): SAML {
  const config = conn.config as SamlConfig;
  if (!config.idpCert?.trim() || !config.idpSsoUrl?.trim()) {
    throw new Error('SAML connection missing idpSsoUrl or idpCert');
  }
  return new SAML({
    issuer: config.spEntityId ?? spEntityId(conn.projectId, conn.id),
    callbackUrl: acsUrl(conn.id),
    entryPoint: config.idpSsoUrl,
    idpCert: config.idpCert,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true,
    validateInResponseTo: ValidateInResponseTo.never,
    acceptedClockSkewMs: 300_000,
  });
}

export async function startSamlLogin(
  connectionId: string,
  relayState?: string,
): Promise<{ redirectUrl: string }> {
  const conn = await getEngineSsoConnection(connectionId);
  if (!conn || conn.deactivatedAt) throw new Error('connection not found');
  if (conn.providerType !== 'saml') throw new Error('not a SAML connection');
  if (!conn.ready) throw new Error('SAML connection not fully configured');
  const saml = buildSaml(conn);
  const url = await saml.getAuthorizeUrlAsync('', '', {});
  if (relayState) {
    const u = new URL(url);
    u.searchParams.set('RelayState', relayState);
    return { redirectUrl: u.toString() };
  }
  return { redirectUrl: url };
}

export async function generateSamlMetadataXml(
  connectionId: string,
): Promise<string> {
  const conn = await getEngineSsoConnection(connectionId);
  if (!conn) throw new Error('connection not found');
  if (conn.providerType !== 'saml') throw new Error('not a SAML connection');
  const saml = buildSaml(conn);
  return saml.generateServiceProviderMetadata('', '');
}

export async function completeSamlLogin(input: {
  connectionId: string;
  samlResponse: string;
}): Promise<{
  sessionHandle: string;
  accessToken: string;
  userId: string;
  email: string;
  projectId: string;
  tenantId: string;
}> {
  const conn = await getEngineSsoConnection(input.connectionId);
  if (!conn || conn.deactivatedAt) throw new Error('connection not found');
  if (conn.providerType !== 'saml') throw new Error('not a SAML connection');
  const saml = buildSaml(conn);
  const result = await saml.validatePostResponseAsync({
    SAMLResponse: input.samlResponse,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profile = (result as any).profile ?? {};
  const emailRaw = profile.email ?? profile.mail ?? profile.nameID;
  if (!emailRaw || typeof emailRaw !== 'string') {
    throw new Error('SAML assertion missing email');
  }
  const email = emailRaw.toLowerCase();
  const name =
    typeof profile.displayName === 'string'
      ? profile.displayName
      : typeof profile.cn === 'string'
        ? profile.cn
        : undefined;

  if (conn.domains.length > 0) {
    const domain = email.split('@')[1] ?? '';
    if (!conn.domains.includes(domain)) {
      throw new Error(`email domain not allowed for this SSO connection`);
    }
  }

  const user = await findOrCreateSsoUser({
    tenantId: conn.tenantId,
    projectId: conn.projectId,
    email,
    name,
    jitEnabled: conn.jitEnabled,
    linkId: `saml:${conn.id}`,
  });
  const session = await createEngineSession({
    userId: user.id,
    tenantId: conn.tenantId,
  });
  log.info('briven_engine_sso_saml_ok', {
    connectionId: conn.id,
    projectId: conn.projectId,
    userId: user.id,
    isNew: user.isNew,
  });
  return {
    sessionHandle: session.sessionHandle,
    accessToken: session.accessToken,
    userId: user.id,
    email,
    projectId: conn.projectId,
    tenantId: conn.tenantId,
  };
}

async function resolveOidcUrls(config: OidcConfig): Promise<{
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
}> {
  let authorizationUrl = config.authorizationUrl?.trim() || '';
  let tokenUrl = config.tokenUrl?.trim() || '';
  let userinfoUrl = config.userinfoUrl?.trim() || '';
  const issuer = config.issuer?.replace(/\/$/, '');

  if ((!authorizationUrl || !tokenUrl) && issuer) {
    try {
      const disco = await fetch(
        `${issuer}/.well-known/openid-configuration`,
      );
      if (disco.ok) {
        const doc = (await disco.json()) as {
          authorization_endpoint?: string;
          token_endpoint?: string;
          userinfo_endpoint?: string;
        };
        authorizationUrl = authorizationUrl || doc.authorization_endpoint || '';
        tokenUrl = tokenUrl || doc.token_endpoint || '';
        userinfoUrl = userinfoUrl || doc.userinfo_endpoint || '';
      }
    } catch {
      /* fall through to path heuristics */
    }
  }

  if (!authorizationUrl && issuer) {
    authorizationUrl = `${issuer}/oauth/authorize`;
  }
  if (!tokenUrl && issuer) {
    tokenUrl = `${issuer}/oauth/token`;
  }
  if (!userinfoUrl && issuer) {
    userinfoUrl = `${issuer}/userinfo`;
  }
  if (!authorizationUrl || !tokenUrl) {
    throw new Error('OIDC missing authorizationUrl/tokenUrl (or issuer)');
  }
  return { authorizationUrl, tokenUrl, userinfoUrl };
}

export async function startOidcLogin(
  connectionId: string,
  redirectUri?: string,
  /** App URL to send the browser after login (sanitized like SAML RelayState). */
  returnTo?: string | null,
): Promise<{ redirectUrl: string; state: string }> {
  const conn = await getEngineSsoConnection(connectionId);
  if (!conn || conn.deactivatedAt) throw new Error('connection not found');
  if (conn.providerType !== 'oidc') throw new Error('not an OIDC connection');
  if (!conn.ready) throw new Error('OIDC connection not fully configured');
  const config = conn.config as OidcConfig;
  const { authorizationUrl } = await resolveOidcUrls(config);
  const state = randomBytes(24).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  const callback =
    redirectUri ||
    `${env.BRIVEN_API_ORIGIN}/v1/auth-core/sso/oidc/${connectionId}/callback`;
  // Sanitize return URL against project allowed origins (same idea as SAML RelayState).
  let safeReturn: string | null = null;
  if (returnTo?.trim()) {
    try {
      const { sanitizeRelayState } = await import('../auth-hardening.js');
      const { getBrivenEngineAppOrigins } = await import('./project-config.js');
      const origins = await getBrivenEngineAppOrigins(conn.projectId);
      safeReturn = sanitizeRelayState(returnTo.trim(), origins) ?? null;
    } catch {
      safeReturn = null;
    }
  }
  const pool = getEnginePool();
  await pool.query(
    `INSERT INTO be_sso_states
      (state_id, connection_id, project_id, provider_type, code_verifier, redirect_uri, return_to, expires_at)
     VALUES ($1,$2,$3,'oidc',$4,$5,$6,$7)`,
    [
      state,
      connectionId,
      conn.projectId,
      codeVerifier,
      callback,
      safeReturn,
      new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    ],
  );
  const u = new URL(authorizationUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', config.clientId!);
  u.searchParams.set('redirect_uri', callback);
  u.searchParams.set('scope', config.scopes || 'openid email profile');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return { redirectUrl: u.toString(), state };
}

export async function completeOidcLogin(input: {
  connectionId: string;
  code: string;
  state: string;
}): Promise<{
  sessionHandle: string;
  accessToken: string;
  userId: string;
  email: string;
  projectId: string;
  tenantId: string;
  /** Safe app return URL when startOidcLogin stored one */
  returnTo: string | null;
}> {
  const conn = await getEngineSsoConnection(input.connectionId);
  if (!conn || conn.deactivatedAt) throw new Error('connection not found');
  if (conn.providerType !== 'oidc') throw new Error('not an OIDC connection');
  const pool = getEnginePool();
  const st = await pool.query(
    `SELECT * FROM be_sso_states WHERE state_id = $1 AND connection_id = $2 LIMIT 1`,
    [input.state, input.connectionId],
  );
  const stateRow = st.rows[0] as
    | {
        code_verifier: string | null;
        redirect_uri: string | null;
        return_to?: string | null;
        expires_at: Date | string;
      }
    | undefined;
  if (!stateRow) throw new Error('invalid or expired OIDC state');
  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    throw new Error('OIDC state expired');
  }
  await pool.query(`DELETE FROM be_sso_states WHERE state_id = $1`, [
    input.state,
  ]);

  const config = conn.config as OidcConfig;
  const { tokenUrl, userinfoUrl } = await resolveOidcUrls(config);
  const redirectUri =
    stateRow.redirect_uri ||
    `${env.BRIVEN_API_ORIGIN}/v1/auth-core/sso/oidc/${input.connectionId}/callback`;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: redirectUri,
    client_id: config.clientId!,
    client_secret: config.clientSecret!,
  });
  if (stateRow.code_verifier) {
    body.set('code_verifier', stateRow.code_verifier);
  }

  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!tokenRes.ok) {
    const t = await tokenRes.text().catch(() => '');
    throw new Error(`OIDC token exchange failed: ${tokenRes.status} ${t}`);
  }
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    id_token?: string;
  };
  if (!tokenJson.access_token) throw new Error('OIDC token response missing access_token');

  let email = '';
  let name: string | undefined;
  if (userinfoUrl) {
    const ui = await fetch(userinfoUrl, {
      headers: { authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (ui.ok) {
      const profile = (await ui.json()) as {
        email?: string;
        name?: string;
        preferred_username?: string;
      };
      email = (profile.email || profile.preferred_username || '').toLowerCase();
      name = profile.name;
    }
  }
  if (!email && tokenJson.id_token) {
    try {
      const payload = JSON.parse(
        Buffer.from(tokenJson.id_token.split('.')[1]!, 'base64url').toString(
          'utf8',
        ),
      ) as { email?: string; name?: string };
      email = (payload.email || '').toLowerCase();
      name = name || payload.name;
    } catch {
      /* ignore */
    }
  }
  if (!email) throw new Error('OIDC profile missing email');

  if (conn.domains.length > 0) {
    const domain = email.split('@')[1] ?? '';
    if (!conn.domains.includes(domain)) {
      throw new Error('email domain not allowed for this SSO connection');
    }
  }

  const user = await findOrCreateSsoUser({
    tenantId: conn.tenantId,
    projectId: conn.projectId,
    email,
    name,
    jitEnabled: conn.jitEnabled,
    linkId: `oidc:${conn.id}`,
  });
  const session = await createEngineSession({
    userId: user.id,
    tenantId: conn.tenantId,
  });
  log.info('briven_engine_sso_oidc_ok', {
    connectionId: conn.id,
    projectId: conn.projectId,
    userId: user.id,
    isNew: user.isNew,
  });
  return {
    sessionHandle: session.sessionHandle,
    accessToken: session.accessToken,
    userId: user.id,
    email,
    projectId: conn.projectId,
    tenantId: conn.tenantId,
    returnTo: stateRow.return_to?.trim() || null,
  };
}

async function findOrCreateSsoUser(input: {
  tenantId: string;
  projectId: string;
  email: string;
  name?: string;
  jitEnabled: boolean;
  linkId: string;
}): Promise<{ id: string; isNew: boolean }> {
  const pool = getEnginePool();
  const existing = await pool.query(
    `SELECT id FROM be_users WHERE tenant_id = $1 AND lower(email) = lower($2) LIMIT 1`,
    [input.tenantId, input.email],
  );
  if (existing.rowCount) {
    return {
      id: (existing.rows[0] as { id: string }).id,
      isNew: false,
    };
  }
  if (!input.jitEnabled) {
    throw new Error('user not found and JIT provisioning disabled');
  }
  const userId = newId('beu');
  await pool.query(
    `INSERT INTO be_users (id, tenant_id, email, email_verified, metadata_json)
     VALUES ($1, $2, $3, true, $4)`,
    [
      userId,
      input.tenantId,
      input.email,
      JSON.stringify({
        name: input.name ?? null,
        sso: input.linkId,
        projectId: input.projectId,
      }),
    ],
  );
  // Link row for uniqueness / audit (reuse third_party_links)
  try {
    await pool.query(
      `INSERT INTO be_third_party_links
        (id, user_id, tenant_id, third_party_id, third_party_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        newId('btp'),
        userId,
        input.tenantId,
        input.linkId.split(':')[0],
        input.linkId,
      ],
    );
  } catch {
    /* optional */
  }
  return { id: userId, isNew: true };
}

/** Public summary for dashboard (no secrets). */
export function publicSsoConnection(c: SsoConnection): Omit<SsoConnection, 'config'> & {
  configKeys: string[];
  productionReady: boolean;
} {
  const { config, ...rest } = c;
  return {
    ...rest,
    configKeys: Object.keys(config).filter(
      (k) => config[k] != null && String(config[k]).length > 0,
    ),
    productionReady: c.ready && !c.deactivatedAt,
  };
}
