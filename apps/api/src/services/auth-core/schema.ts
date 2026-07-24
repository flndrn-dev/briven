/**
 * Doltgres schema for briven-engine (all Auth product state).
 * Applied at boot via ensure + bootstrap — no stock Postgres.
 */

import { getEnginePool } from './db.js';
import { log } from '../../lib/logger.js';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS be_tenants (
    tenant_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS be_users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'public',
    email TEXT,
    phone TEXT,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    time_joined TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata_json TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS be_users_tenant_email_idx ON be_users (tenant_id, email)`,
  `CREATE INDEX IF NOT EXISTS be_users_tenant_phone_idx ON be_users (tenant_id, phone)`,
  `CREATE TABLE IF NOT EXISTS be_password_hashes (
    user_id TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS be_sessions (
    session_handle TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'public',
    refresh_token_hash TEXT NOT NULL,
    access_payload_json TEXT NOT NULL DEFAULT '{}',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS be_sessions_user_idx ON be_sessions (user_id)`,
  `CREATE TABLE IF NOT EXISTS be_passwordless_codes (
    pre_auth_session_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'public',
    email TEXT,
    phone TEXT,
    code_hash TEXT NOT NULL,
    device_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS be_third_party_links (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'public',
    third_party_id TEXT NOT NULL,
    third_party_user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS be_tp_unique
    ON be_third_party_links (tenant_id, third_party_id, third_party_user_id)`,
  // MFA TOTP devices
  `CREATE TABLE IF NOT EXISTS be_totp_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'public',
    device_name TEXT NOT NULL,
    secret_base32 TEXT NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS be_totp_user_idx ON be_totp_devices (user_id)`,
  // Passkeys / WebAuthn
  `CREATE TABLE IF NOT EXISTS be_webauthn_challenges (
    challenge_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'public',
    user_id TEXT,
    challenge TEXT NOT NULL,
    type TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS be_webauthn_credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'public',
    credential_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    device_type TEXT,
    backed_up BOOLEAN NOT NULL DEFAULT FALSE,
    transports TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS be_webauthn_cred_unique
    ON be_webauthn_credentials (tenant_id, credential_id)`,
  `CREATE INDEX IF NOT EXISTS be_webauthn_user_idx ON be_webauthn_credentials (user_id)`,
  // Roles
  `CREATE TABLE IF NOT EXISTS be_roles (
    tenant_id TEXT NOT NULL,
    role_name TEXT NOT NULL,
    permissions_json TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, role_name)
  )`,
  `CREATE TABLE IF NOT EXISTS be_user_roles (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, user_id, role_name)
  )`,
  // Abuse counters (fallback when Redis unavailable)
  `CREATE TABLE IF NOT EXISTS be_rate_limits (
    bucket_key TEXT PRIMARY KEY,
    hit_count INT NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  // Enterprise SSO (SAML + OIDC) — briven-engine native
  `CREATE TABLE IF NOT EXISTS be_sso_connections (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    domains_json TEXT NOT NULL DEFAULT '[]',
    config_json TEXT NOT NULL DEFAULT '{}',
    jit_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    deactivated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS be_sso_conn_project_idx ON be_sso_connections (project_id)`,
  `CREATE TABLE IF NOT EXISTS be_sso_states (
    state_id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    code_verifier TEXT,
    redirect_uri TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  // Security audit trail (SuperTokens-class event log; no raw IPs)
  `CREATE TABLE IF NOT EXISTS be_audit_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'public',
    project_id TEXT,
    user_id TEXT,
    action TEXT NOT NULL,
    ip_hash_hint TEXT,
    user_agent TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS be_audit_tenant_time_idx
    ON be_audit_events (tenant_id, occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS be_audit_project_time_idx
    ON be_audit_events (project_id, occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS be_audit_action_time_idx
    ON be_audit_events (action, occurred_at DESC)`,
  // M2M OAuth2 client credentials (machine clients → short-lived tokens)
  `CREATE TABLE IF NOT EXISTS be_m2m_clients (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'public',
    name TEXT NOT NULL,
    secret_hash TEXT NOT NULL,
    secret_suffix TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'developer',
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS be_m2m_project_idx
    ON be_m2m_clients (project_id)`,
  // ─── OIDC / OAuth2 IdP (Briven as SuperTokens-class provider) ───
  `CREATE TABLE IF NOT EXISTS be_oidc_signing_keys (
    kid TEXT PRIMARY KEY,
    private_pem TEXT NOT NULL,
    public_jwk_json TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS be_oidc_clients (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'public',
    name TEXT NOT NULL,
    logo_url TEXT,
    client_secret_hash TEXT,
    client_secret_suffix TEXT,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    redirect_uris_json TEXT NOT NULL DEFAULT '[]',
    post_logout_uris_json TEXT NOT NULL DEFAULT '[]',
    grant_types_json TEXT NOT NULL DEFAULT '["authorization_code","refresh_token"]',
    scopes_json TEXT NOT NULL DEFAULT '["openid","profile","email","offline_access"]',
    token_endpoint_auth_method TEXT NOT NULL DEFAULT 'client_secret_post',
    created_by TEXT,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS be_oidc_clients_project_idx
    ON be_oidc_clients (project_id)`,
  `CREATE TABLE IF NOT EXISTS be_oidc_auth_requests (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    scope TEXT NOT NULL,
    state TEXT,
    nonce TEXT,
    code_challenge TEXT,
    code_challenge_method TEXT,
    response_type TEXT NOT NULL DEFAULT 'code',
    user_id TEXT,
    consented_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS be_oidc_auth_req_exp_idx
    ON be_oidc_auth_requests (expires_at)`,
  `CREATE TABLE IF NOT EXISTS be_oidc_auth_codes (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    scope TEXT NOT NULL,
    nonce TEXT,
    code_challenge TEXT,
    code_challenge_method TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS be_oidc_refresh_tokens (
    token_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS be_oidc_refresh_client_idx
    ON be_oidc_refresh_tokens (client_id)`,
  `CREATE TABLE IF NOT EXISTS be_oidc_consents (
    user_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, client_id)
  )`,
];

export async function bootstrapBrivenEngineSchema(): Promise<void> {
  const pool = getEnginePool();
  for (const sql of STATEMENTS) {
    try {
      await pool.query(sql);
    } catch (err) {
      // Doltgres may reject IF NOT EXISTS on some objects — retry without, or log.
      const message = err instanceof Error ? err.message : String(err);
      if (/already exists/i.test(message)) continue;
      log.warn('briven_engine_schema_stmt', { message, sql: sql.slice(0, 80) });
      throw err;
    }
  }
  log.info('briven_engine_schema_ready', {
    engine: 'briven-engine',
    storage: 'doltgres',
    tables: [
      'be_tenants',
      'be_users',
      'be_password_hashes',
      'be_sessions',
      'be_passwordless_codes',
      'be_third_party_links',
      'be_totp_devices',
      'be_webauthn_challenges',
      'be_webauthn_credentials',
      'be_roles',
      'be_user_roles',
      'be_rate_limits',
      'be_sso_connections',
      'be_sso_states',
      'be_audit_events',
      'be_m2m_clients',
      'be_oidc_signing_keys',
      'be_oidc_clients',
      'be_oidc_auth_requests',
      'be_oidc_auth_codes',
      'be_oidc_refresh_tokens',
      'be_oidc_consents',
    ],
  });
}
