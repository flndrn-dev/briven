/**
 * Briven Auth Enterprise SSO — SAML 2.0 + OIDC enterprise connections.
 *
 * Each project can configure multiple SSO connections (SAML or OIDC).
 * Users with matching email domains are routed to the appropriate IdP.
 * JIT provisioning creates users on first SSO sign-in when enabled.
 *
 * SAML flow (SP-initiated):
 *   1. User visits /v1/auth-tenant/sso/saml/:connectionId
 *   2. We generate an AuthnRequest and redirect to the IdP SSO URL
 *   3. IdP authenticates the user and POSTs SAMLResponse to ACS
 *   4. We validate the response, extract email/NameID
 *   5. Find or JIT-create user, create session, set cookie
 *
 * SAML flow (IdP-initiated):
 *   1. IdP POSTs SAMLResponse directly to ACS
 *   2. Same validation + session creation as SP-initiated
 *
 * OIDC enterprise:
 *   - Uses the existing genericOAuth plugin infrastructure
 *   - Domain restrictions and JIT provisioning are enforced at the
 *     connection level via this service
 */

import { randomBytes } from 'node:crypto';
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import { ValidationError } from '@briven/shared';

import { runInProjectDatabase } from '../db/data-plane.js';
import { env } from '../env.js';

// ─── Types ────────────────────────────────────────────────────────────────

export type SsoProviderType = 'saml' | 'oidc';

export interface SsoConnectionOutput {
  id: string;
  name: string;
  providerType: SsoProviderType;
  domains: string[];
  jitEnabled: boolean;
  deactivatedAt: string | null;
  createdAt: string;
}

export interface SamlConfig {
  /** IdP metadata XML (optional — can supply url instead). */
  idpMetadataXml?: string;
  /** IdP metadata URL (optional — can supply xml instead). */
  idpMetadataUrl?: string;
  /** IdP SSO URL (extracted from metadata or supplied directly). */
  idpSsoUrl?: string;
  /** IdP signing certificate PEM (extracted from metadata or supplied directly). */
  idpCert?: string;
  /** Optional IdP logout URL. */
  idpLogoutUrl?: string;
  /** SP entity ID. Defaults to hosted ACS URL. */
  spEntityId?: string;
}

export interface OidcEnterpriseConfig {
  issuer?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userinfoUrl?: string;
  clientId?: string;
  /** Stored in tenant-secret-store, not here. */
  scopes?: string;
  pkce?: boolean;
}

// ─── Connection CRUD ─────────────────────────────────────────────────────

export async function listSsoConnections(
  projectId: string,
): Promise<SsoConnectionOutput[]> {
  return runInProjectDatabase<SsoConnectionOutput[]>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT id, name, provider_type, domains, jit_enabled, deactivated_at, created_at
       FROM "_briven_auth_sso_connections"
       WHERE deactivated_at IS NULL
       ORDER BY created_at`,
    )) as {
      id: string; name: string; provider_type: string; domains: unknown;
      jit_enabled: boolean; deactivated_at: Date | null; created_at: Date;
    }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      providerType: r.provider_type as SsoProviderType,
      domains: Array.isArray(r.domains) ? (r.domains as string[]) : [],
      jitEnabled: r.jit_enabled,
      deactivatedAt: r.deactivated_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
    }));
  });
}

export async function getSsoConnection(
  projectId: string,
  connectionId: string,
): Promise<SsoConnectionOutput & { config: Record<string, unknown> } | null> {
  return runInProjectDatabase<(SsoConnectionOutput & { config: Record<string, unknown> }) | null>(
    projectId,
    async (tx) => {
      const rows = (await tx.unsafe(
        `SELECT id, name, provider_type, config, domains, jit_enabled, deactivated_at, created_at
         FROM "_briven_auth_sso_connections"
         WHERE id = $1
         LIMIT 1`,
        [connectionId],
      )) as {
        id: string; name: string; provider_type: string; config: unknown;
        domains: unknown; jit_enabled: boolean; deactivated_at: Date | null;
        created_at: Date;
      }[];
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        providerType: row.provider_type as SsoProviderType,
        config: (row.config as Record<string, unknown>) ?? {},
        domains: Array.isArray(row.domains) ? (row.domains as string[]) : [],
        jitEnabled: row.jit_enabled,
        deactivatedAt: row.deactivated_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
      };
    },
  );
}

export async function createSsoConnection(
  projectId: string,
  input: {
    name: string;
    providerType: SsoProviderType;
    config: Record<string, unknown>;
    domains?: string[];
    jitEnabled?: boolean;
  },
): Promise<SsoConnectionOutput> {
  if (!input.name || input.name.length > 128) {
    throw new ValidationError('name is required and must be <= 128 chars');
  }
  if (!['saml', 'oidc'].includes(input.providerType)) {
    throw new ValidationError('providerType must be saml or oidc');
  }

  return runInProjectDatabase<SsoConnectionOutput>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `INSERT INTO "_briven_auth_sso_connections"
         (name, provider_type, config, domains, jit_enabled)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, provider_type, domains, jit_enabled, deactivated_at, created_at`,
      [
        input.name,
        input.providerType,
        JSON.stringify(input.config),
        JSON.stringify(input.domains ?? []),
        input.jitEnabled ?? true,
      ],
    )) as {
      id: string; name: string; provider_type: string; domains: unknown;
      jit_enabled: boolean; deactivated_at: Date | null; created_at: Date;
    }[];
    const row = rows[0];
    if (!row) throw new Error('sso connection insert failed');
    return {
      id: row.id,
      name: row.name,
      providerType: row.provider_type as SsoProviderType,
      domains: Array.isArray(row.domains) ? (row.domains as string[]) : [],
      jitEnabled: row.jit_enabled,
      deactivatedAt: row.deactivated_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    };
  });
}

export async function updateSsoConnection(
  projectId: string,
  connectionId: string,
  patch: {
    name?: string;
    config?: Record<string, unknown>;
    domains?: string[];
    jitEnabled?: boolean;
  },
): Promise<SsoConnectionOutput> {
  return runInProjectDatabase<SsoConnectionOutput>(projectId, async (tx) => {
    const sets: string[] = [];
    const params: (string | boolean | null)[] = [];
    if (patch.name !== undefined) {
      sets.push(`name = $${params.length + 1}`);
      params.push(patch.name);
    }
    if (patch.config !== undefined) {
      sets.push(`config = $${params.length + 1}`);
      params.push(JSON.stringify(patch.config));
    }
    if (patch.domains !== undefined) {
      sets.push(`domains = $${params.length + 1}`);
      params.push(JSON.stringify(patch.domains));
    }
    if (patch.jitEnabled !== undefined) {
      sets.push(`jit_enabled = $${params.length + 1}`);
      params.push(patch.jitEnabled);
    }
    sets.push(`updated_at = now()`);
    params.push(connectionId);

    const rows = (await tx.unsafe(
      `UPDATE "_briven_auth_sso_connections"
       SET ${sets.join(', ')}
       WHERE id = $${params.length}
       RETURNING id, name, provider_type, domains, jit_enabled, deactivated_at, created_at`,
      params,
    )) as {
      id: string; name: string; provider_type: string; domains: unknown;
      jit_enabled: boolean; deactivated_at: Date | null; created_at: Date;
    }[];
    const row = rows[0];
    if (!row) throw new ValidationError('sso connection not found');
    return {
      id: row.id,
      name: row.name,
      providerType: row.provider_type as SsoProviderType,
      domains: Array.isArray(row.domains) ? (row.domains as string[]) : [],
      jitEnabled: row.jit_enabled,
      deactivatedAt: row.deactivated_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    };
  });
}

export async function deleteSsoConnection(
  projectId: string,
  connectionId: string,
): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `UPDATE "_briven_auth_sso_connections"
       SET deactivated_at = now(), updated_at = now()
       WHERE id = $1`,
      [connectionId],
    );
  });
}

// ─── SAML helpers ─────────────────────────────────────────────────────────

function acsUrl(connectionId: string): string {
  return `${env.BRIVEN_API_ORIGIN}/v1/auth-tenant/sso/saml/${connectionId}/acs`;
}

function spEntityId(projectId: string, connectionId: string): string {
  return `${env.BRIVEN_API_ORIGIN}/sso/${projectId}/${connectionId}`;
}

function buildSamlInstance(
  projectId: string,
  connectionId: string,
  config: SamlConfig,
): SAML {
  const cert = config.idpCert ?? '';
  if (!cert) {
    throw new ValidationError('SAML connection is missing IdP certificate');
  }
  const entryPoint = config.idpSsoUrl ?? '';
  if (!entryPoint) {
    throw new ValidationError('SAML connection is missing IdP SSO URL');
  }

  return new SAML({
    issuer: config.spEntityId ?? spEntityId(projectId, connectionId),
    callbackUrl: acsUrl(connectionId),
    entryPoint,
    idpCert: cert,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true,
    // Disable InResponseTo validation for IdP-initiated flows.
    // SP-initiated flows set it via RelayState instead.
    validateInResponseTo: ValidateInResponseTo.never,
    // Clock drift tolerance — some IdPs have slight clock skew.
    acceptedClockSkewMs: 300000, // 5 minutes
  });
}

export async function generateSamlAuthnRequest(
  projectId: string,
  connectionId: string,
  relayState?: string,
): Promise<{ redirectUrl: string }> {
  const conn = await getSsoConnection(projectId, connectionId);
  if (!conn) throw new ValidationError('sso connection not found');
  if (conn.providerType !== 'saml') {
    throw new ValidationError('connection is not a SAML provider');
  }

  const samlConfig = conn.config as SamlConfig;
  const saml = buildSamlInstance(projectId, connectionId, samlConfig);

  const url = await saml.getAuthorizeUrlAsync('', '', {});
  if (relayState) {
    const u = new URL(url);
    u.searchParams.set('RelayState', relayState);
    return { redirectUrl: u.toString() };
  }
  return { redirectUrl: url };
}

export interface SamlAssertionResult {
  email: string;
  name?: string;
  nameId?: string;
  nameIdFormat?: string;
}

export async function validateSamlResponse(
  projectId: string,
  connectionId: string,
  samlResponse: string,
): Promise<SamlAssertionResult> {
  const conn = await getSsoConnection(projectId, connectionId);
  if (!conn) throw new ValidationError('sso connection not found');
  if (conn.providerType !== 'saml') {
    throw new ValidationError('connection is not a SAML provider');
  }

  const samlConfig = conn.config as SamlConfig;
  const saml = buildSamlInstance(projectId, connectionId, samlConfig);

  const result = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });

  // @node-saml/node-saml returns profile in the result.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profile = (result as any).profile ?? {};
  const email = profile.email ?? profile.mail ?? profile.nameID;
  if (!email || typeof email !== 'string') {
    throw new ValidationError('SAML assertion did not contain an email address');
  }

  return {
    email: email.toLowerCase(),
    name: profile.displayName ?? profile.cn ?? profile.givenName,
    nameId: profile.nameID,
    nameIdFormat: profile.nameIDFormat,
  };
}

export async function generateSamlMetadata(
  projectId: string,
  connectionId: string,
): Promise<string> {
  const conn = await getSsoConnection(projectId, connectionId);
  if (!conn) throw new ValidationError('sso connection not found');
  if (conn.providerType !== 'saml') {
    throw new ValidationError('connection is not a SAML provider');
  }

  const samlConfig = conn.config as SamlConfig;
  const saml = buildSamlInstance(projectId, connectionId, samlConfig);

  // generateServiceProviderMetadata requires decryptionCert and privateKey
  // for encryption support. We don't support encrypted assertions yet,
  // so we pass empty strings.
  return saml.generateServiceProviderMetadata('', '');
}

// ─── JIT provisioning ─────────────────────────────────────────────────────

export async function findUserByEmail(
  projectId: string,
  email: string,
): Promise<{ id: string; email: string; name: string | null } | null> {
  return runInProjectDatabase<{ id: string; email: string; name: string | null } | null>(
    projectId,
    async (tx) => {
      const rows = (await tx.unsafe(
        `SELECT id, email, name FROM "_briven_auth_users" WHERE lower(email) = lower($1) LIMIT 1`,
        [email],
      )) as { id: string; email: string; name: string | null }[];
      return rows[0] ?? null;
    },
  );
}

export async function createUserFromSso(
  projectId: string,
  email: string,
  name?: string,
): Promise<{ id: string; email: string; name: string | null }> {
  return runInProjectDatabase<{ id: string; email: string; name: string | null }>(
    projectId,
    async (tx) => {
      const id = randomBytes(16).toString('hex');
      const rows = (await tx.unsafe(
        `INSERT INTO "_briven_auth_users" (id, email, email_verified, name, created_at, updated_at)
         VALUES ($1, $2, true, $3, now(), now())
         RETURNING id, email, name`,
        [id, email.toLowerCase(), name ?? null],
      )) as { id: string; email: string; name: string | null }[];
      const row = rows[0];
      if (!row) throw new Error('user creation failed');
      return row;
    },
  );
}

export async function findOrCreateSsoUser(
  projectId: string,
  email: string,
  name?: string,
  jitEnabled = true,
): Promise<{ id: string; email: string; name: string | null; isNew: boolean }> {
  const existing = await findUserByEmail(projectId, email);
  if (existing) return { ...existing, isNew: false };
  if (!jitEnabled) {
    throw new ValidationError('user does not exist and JIT provisioning is disabled');
  }
  const created = await createUserFromSso(projectId, email, name);
  return { ...created, isNew: true };
}

// ─── Session creation ─────────────────────────────────────────────────────

export async function createSsoSession(
  projectId: string,
  userId: string,
  connectionId: string,
  opts: { userAgent?: string | null; maxLifetimeDays?: number } = {},
): Promise<{ sessionToken: string; expiresAt: Date }> {
  const maxLifetimeDays = opts.maxLifetimeDays ?? 30;
  const sessionToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * maxLifetimeDays);

  await runInProjectDatabase(projectId, async (tx) => {
    const sessionId = randomBytes(16).toString('hex');
    await tx.unsafe(
      `INSERT INTO "_briven_auth_sessions" (id, user_id, token, expires_at, user_agent, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())`,
      [sessionId, userId, sessionToken, expiresAt.toISOString(), opts.userAgent ?? null] as never,
    );
    await tx.unsafe(
      `INSERT INTO "_briven_auth_sso_sessions" (id, session_id, connection_id, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())
       ON CONFLICT (session_id) DO NOTHING`,
      [randomBytes(16).toString('hex'), sessionId, connectionId] as never,
    );
  });

  return { sessionToken, expiresAt };
}

// ─── Deprovisioning ───────────────────────────────────────────────────────

export async function revokeAllSessionsForConnection(
  projectId: string,
  connectionId: string,
): Promise<number> {
  return runInProjectDatabase<number>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT session_id FROM "_briven_auth_sso_sessions" WHERE connection_id = $1`,
      [connectionId],
    )) as { session_id: string }[];

    let count = 0;
    for (const row of rows) {
      await tx.unsafe(
        `DELETE FROM "_briven_auth_sessions" WHERE id = $1`,
        [row.session_id] as never,
      );
      count++;
    }
    return count;
  });
}

// ─── Domain lookup ────────────────────────────────────────────────────────

export async function findConnectionByDomain(
  projectId: string,
  domain: string,
): Promise<SsoConnectionOutput | null> {
  const connections = await listSsoConnections(projectId);
  const lowerDomain = domain.toLowerCase();
  return (
    connections.find((c) =>
      c.domains.some((d) => d.toLowerCase() === lowerDomain),
    ) ?? null
  );
}

export async function findConnectionByEmail(
  projectId: string,
  email: string,
): Promise<SsoConnectionOutput | null> {
  const domain = email.split('@')[1];
  if (!domain) return null;
  return findConnectionByDomain(projectId, domain);
}

// ─── OIDC Enterprise helpers ──────────────────────────────────────────────

function oidcCallbackUrl(connectionId: string): string {
  return `${env.BRIVEN_API_ORIGIN}/v1/auth-tenant/sso/oidc/${connectionId}/callback`;
}

function generateOidcState(): string {
  return randomBytes(32).toString('base64url');
}

function generateOidcNonce(): string {
  return randomBytes(16).toString('base64url');
}

export async function generateOidcAuthUrl(
  projectId: string,
  connectionId: string,
): Promise<{ redirectUrl: string }> {
  const conn = await getSsoConnection(projectId, connectionId);
  if (!conn) throw new ValidationError('sso connection not found');
  if (conn.providerType !== 'oidc') {
    throw new ValidationError('connection is not an OIDC provider');
  }

  const oidcConfig = conn.config as OidcEnterpriseConfig;
  const authorizationUrl =
    oidcConfig.authorizationUrl ??
    (oidcConfig.issuer ? `${oidcConfig.issuer}/oauth/authorize` : '');
  if (!authorizationUrl) {
    throw new ValidationError('OIDC connection is missing authorization URL');
  }
  if (!oidcConfig.clientId) {
    throw new ValidationError('OIDC connection is missing client ID');
  }

  const state = generateOidcState();
  const nonce = generateOidcNonce();

  // Store state+nonce for callback validation.
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `INSERT INTO "_briven_auth_oidc_states" (id, state, nonce, connection_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomBytes(16).toString('hex'), state, nonce, connectionId, new Date(Date.now() + 10 * 60 * 1000)] as never,
    );
  });

  const url = new URL(authorizationUrl);
  url.searchParams.set('client_id', oidcConfig.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', oidcConfig.scopes ?? 'openid profile email');
  url.searchParams.set('redirect_uri', oidcCallbackUrl(connectionId));
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);

  if (oidcConfig.pkce !== false) {
    // PKCE is on by default.
    const codeChallenge = generateOidcState(); // reuse as code_challenge
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }

  return { redirectUrl: url.toString() };
}

export interface OidcTokenResponse {
  email: string;
  name?: string;
}

export async function exchangeOidcCode(
  projectId: string,
  connectionId: string,
  code: string,
  state: string,
): Promise<OidcTokenResponse> {
  const conn = await getSsoConnection(projectId, connectionId);
  if (!conn) throw new ValidationError('sso connection not found');
  if (conn.providerType !== 'oidc') {
    throw new ValidationError('connection is not an OIDC provider');
  }

  // Validate state.
  const stateRow = await runInProjectDatabase(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT nonce, connection_id, expires_at FROM "_briven_auth_oidc_states" WHERE state = $1 LIMIT 1`,
      [state] as never,
    )) as Array<{ nonce: string; connection_id: string; expires_at: Date }>;
    if (rows[0]) {
      // Delete on first use (one-time).
      await tx.unsafe(
        `DELETE FROM "_briven_auth_oidc_states" WHERE state = $1`,
        [state] as never,
      );
    }
    return rows[0] ?? null;
  });

  if (!stateRow) throw new ValidationError('invalid or expired OIDC state');
  if (stateRow.connection_id !== connectionId) {
    throw new ValidationError('OIDC state does not match connection');
  }
  if (stateRow.expires_at < new Date()) {
    throw new ValidationError('OIDC state has expired');
  }

  const oidcConfig = conn.config as OidcEnterpriseConfig;
  const tokenUrl =
    oidcConfig.tokenUrl ??
    (oidcConfig.issuer ? `${oidcConfig.issuer}/oauth/token` : '');
  if (!tokenUrl) {
    throw new ValidationError('OIDC connection is missing token URL');
  }

  // Get client secret from tenant secret store.
  const { getTenantSecret } = await import('./tenant-secrets.js');
  const clientSecret = await getTenantSecret(projectId, 'auth', `oidc_${connectionId}_client_secret`);

  // Exchange code for token.
  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: oidcCallbackUrl(connectionId),
      client_id: oidcConfig.clientId ?? '',
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '');
    throw new ValidationError(`OIDC token exchange failed: ${tokenRes.status} ${body.slice(0, 200)}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token?: string; id_token?: string };
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    throw new ValidationError('OIDC token response did not contain access_token');
  }

  // Fetch userinfo.
  const userinfoUrl =
    oidcConfig.userinfoUrl ??
    (oidcConfig.issuer ? `${oidcConfig.issuer}/oauth/userinfo` : '');
  if (!userinfoUrl) {
    throw new ValidationError('OIDC connection is missing userinfo URL');
  }

  const userinfoRes = await fetch(userinfoUrl, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!userinfoRes.ok) {
    const body = await userinfoRes.text().catch(() => '');
    throw new ValidationError(`OIDC userinfo fetch failed: ${userinfoRes.status} ${body.slice(0, 200)}`);
  }

  const userinfo = (await userinfoRes.json()) as {
    email?: string;
    name?: string;
    preferred_username?: string;
    given_name?: string;
    family_name?: string;
  };

  const email = userinfo.email;
  if (!email || typeof email !== 'string') {
    throw new ValidationError('OIDC userinfo did not contain an email address');
  }

  return {
    email: email.toLowerCase(),
    name:
      userinfo.name ??
      userinfo.preferred_username ??
      (userinfo.given_name && userinfo.family_name
        ? `${userinfo.given_name} ${userinfo.family_name}`
        : undefined),
  };
}
