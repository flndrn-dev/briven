/**
 * SQL emitter for the briven auth customer-schema tables.
 *
 * Called once per project, the first time a customer clicks **Enable Auth**
 * in the dashboard. Emits a single transactional batch of statements that:
 *   1. ensures the `citext` extension exists in the project's schema
 *   2. creates the six `_briven_auth_*` tables
 *   3. creates the supporting indexes
 *
 * Shape matches BUILD_PLAN.md §3 exactly. Drizzle model definitions live
 * at `apps/api/src/db/auth-customer-schema.ts` and stay the source of
 * truth for application-layer reads; this emitter is the source of truth
 * for the DDL that lands in the customer schema.
 *
 * Why not run drizzle-kit migrate? Customer schemas are dynamic — one
 * per project — and drizzle-kit's snapshot/diff workflow is built for a
 * fixed schema set. Hand-emitting the DDL keeps the provisioning step
 * idempotent (IF NOT EXISTS everywhere) and free of the drizzle-kit TTY
 * blocker tracked in road-to-ga.md §2.9.
 *
 * Idempotency: every statement is `IF NOT EXISTS`. Re-running on an
 * already-provisioned schema is a no-op, which matters because the
 * provisioning route is idempotent by design (BUILD_PLAN.md §4 admin
 * endpoint `POST /v1/projects/:id/auth/enable`).
 */

/**
 * DDL for `_briven_auth_jwks` — Better Auth's jwt-plugin key store (model
 * `jwks`: id, publicKey, privateKey, createdAt, expiresAt). The private key
 * is encrypted at rest by Better Auth with the instance secret before it is
 * written, so the column holds ciphertext JSON, never a raw key.
 *
 * Exported separately (not just inside `renderAuthProvisioningSql`) because
 * the jwks table postdates many live projects: `auth-tenant-pool.ts` re-runs
 * this single idempotent statement on tenant-instance boot so existing
 * projects self-heal without a re-provisioning step. New tables via
 * `CREATE TABLE IF NOT EXISTS` are safe on DoltGres (ALTER ADD COLUMN
 * IF NOT EXISTS is not — never retrofit columns onto existing tables).
 */
export const AUTH_JWKS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS "_briven_auth_jwks" (
   id           text        PRIMARY KEY,
   public_key   text        NOT NULL,
   private_key  text        NOT NULL,
   created_at   timestamptz NOT NULL DEFAULT now(),
   expires_at   timestamptz
 )`
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Emit the full DDL batch for a project's auth tables. Caller wraps it in
 * `runInProjectDatabase(projectId, tx)` — the connection is bound to the
 * project's own DoltGres database (`proj_<id>`, public schema), so no
 * search_path is needed. Tables are shaped to Better Auth's schema (S2.1b).
 */
export function renderAuthProvisioningSql(): string[] {
  return [
    // _briven_auth_users — Better-Auth user shape (sprint S2.1b).
    // DoltGres has no `citext`/`CREATE EXTENSION`; case-insensitive email is a
    // `text` column + a UNIQUE index on `lower(email)` (verified on DoltGres).
    // `email_verified` is BOOLEAN — what Better Auth reads/writes.
    `CREATE TABLE IF NOT EXISTS "_briven_auth_users" (
       id                text        PRIMARY KEY,
       name              text,
       email             text        NOT NULL,
       email_verified    boolean     NOT NULL DEFAULT false,
       image             text,
       two_factor_enabled boolean    NOT NULL DEFAULT false,
       created_at        timestamptz NOT NULL DEFAULT now(),
       updated_at        timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_users_email_uniq"
       ON "_briven_auth_users" (lower(email))`,

    // _briven_auth_sessions — Better-Auth session shape. `ip_address` exists for
    // compatibility but IP tracking is disabled (privacy), so it stays null.
    `CREATE TABLE IF NOT EXISTS "_briven_auth_sessions" (
       id          text        PRIMARY KEY,
       user_id     text        NOT NULL REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE,
       token       text        NOT NULL,
       expires_at  timestamptz NOT NULL,
       ip_address  text,
       user_agent  text,
       created_at  timestamptz NOT NULL DEFAULT now(),
       updated_at  timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_sessions_token_uniq"
       ON "_briven_auth_sessions" (token)`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_sessions_user_idx"
       ON "_briven_auth_sessions" (user_id)`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_sessions_expires_idx"
       ON "_briven_auth_sessions" (expires_at)`,

    // _briven_auth_accounts — Better-Auth account shape. The email/password
    // "credential" account stores the password hash in `password`. OAuth token
    // columns are present but unused in v1 (no social providers wired).
    `CREATE TABLE IF NOT EXISTS "_briven_auth_accounts" (
       id                        text        PRIMARY KEY,
       user_id                   text        NOT NULL REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE,
       account_id                text        NOT NULL,
       provider_id               text        NOT NULL,
       access_token              text,
       refresh_token             text,
       id_token                  text,
       access_token_expires_at   timestamptz,
       refresh_token_expires_at  timestamptz,
       scope                     text,
       password                  text,
       created_at                timestamptz NOT NULL DEFAULT now(),
       updated_at                timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_accounts_provider_pair_uniq"
       ON "_briven_auth_accounts" (provider_id, account_id)`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_accounts_user_idx"
       ON "_briven_auth_accounts" (user_id)`,

    // _briven_auth_verification_tokens — Better-Auth verification shape.
    // Better Auth creates + consumes these rows directly ({identifier,value}).
    `CREATE TABLE IF NOT EXISTS "_briven_auth_verification_tokens" (
       id          text        PRIMARY KEY,
       identifier  text        NOT NULL,
       value       text        NOT NULL,
       expires_at  timestamptz NOT NULL,
       created_at  timestamptz NOT NULL DEFAULT now(),
       updated_at  timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_verif_identifier_idx"
       ON "_briven_auth_verification_tokens" (identifier)`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_verif_expires_idx"
       ON "_briven_auth_verification_tokens" (expires_at)`,

    // _briven_auth_audit_log
    `CREATE TABLE IF NOT EXISTS "_briven_auth_audit_log" (
       id               text        PRIMARY KEY,
       user_id          text        REFERENCES "_briven_auth_users"(id) ON DELETE SET NULL,
       action           text        NOT NULL,
       ip_address_hash  text,
       user_agent       text,
       metadata         jsonb       NOT NULL DEFAULT '{}'::jsonb,
       occurred_at      timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_audit_user_occurred_idx"
       ON "_briven_auth_audit_log" (user_id, occurred_at DESC)`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_audit_action_occurred_idx"
       ON "_briven_auth_audit_log" (action, occurred_at DESC)`,

    // _briven_auth_jwks — jwt-plugin signing keys (shared constant above so
    // the tenant-pool boot ensure and this batch never drift).
    AUTH_JWKS_TABLE_SQL,

    // ─── Organizations (Phase 2 — Clerk-competitor) ─────────────────────────
    `CREATE TABLE IF NOT EXISTS "_briven_auth_orgs" (
       id          text        PRIMARY KEY,
       name        text        NOT NULL,
       slug        text        NOT NULL,
       logo        text,
       metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
       created_at  timestamptz NOT NULL DEFAULT now(),
       updated_at  timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_orgs_slug_uniq"
       ON "_briven_auth_orgs" (slug)`,

    `CREATE TABLE IF NOT EXISTS "_briven_auth_org_members" (
       id            text        PRIMARY KEY,
       org_id        text        NOT NULL REFERENCES "_briven_auth_orgs"(id) ON DELETE CASCADE,
       user_id       text        NOT NULL REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE,
       role          text        NOT NULL DEFAULT 'member',
       created_at    timestamptz NOT NULL DEFAULT now(),
       updated_at    timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_org_members_pair_uniq"
       ON "_briven_auth_org_members" (org_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_org_members_user_idx"
       ON "_briven_auth_org_members" (user_id)`,

    `CREATE TABLE IF NOT EXISTS "_briven_auth_org_invites" (
       id          text        PRIMARY KEY,
       org_id      text        NOT NULL REFERENCES "_briven_auth_orgs"(id) ON DELETE CASCADE,
       email       text        NOT NULL,
       role        text        NOT NULL DEFAULT 'member',
       token       text        NOT NULL,
       expires_at  timestamptz NOT NULL,
       invited_by  text        REFERENCES "_briven_auth_users"(id) ON DELETE SET NULL,
       accepted_at timestamptz,
       created_at  timestamptz NOT NULL DEFAULT now(),
       updated_at  timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_org_invites_token_uniq"
       ON "_briven_auth_org_invites" (token)`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_org_invites_org_idx"
       ON "_briven_auth_org_invites" (org_id)`,

    // ─── Two-Factor (Phase 3) ───────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS "_briven_auth_two_factors" (
       id            text        PRIMARY KEY,
       secret        text        NOT NULL,
       backup_codes  text        NOT NULL,
       user_id       text        NOT NULL REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE,
       verified      boolean     NOT NULL DEFAULT true,
       created_at    timestamptz NOT NULL DEFAULT now(),
       updated_at    timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_two_factors_user_idx"
       ON "_briven_auth_two_factors" (user_id)`,

    // ─── Passkeys (Phase 3) ─────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS "_briven_auth_passkeys" (
       id            text        PRIMARY KEY,
       name          text,
       public_key    text        NOT NULL,
       user_id       text        NOT NULL REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE,
       credential_id text        NOT NULL,
       counter       bigint      NOT NULL DEFAULT 0,
       created_at    timestamptz NOT NULL DEFAULT now(),
       updated_at    timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_passkeys_user_idx"
       ON "_briven_auth_passkeys" (user_id)`,

    // ─── User Security (Phase 1 — suspensions, bans) ────────────────────────
    `CREATE TABLE IF NOT EXISTS "_briven_auth_user_security" (
       id                text        PRIMARY KEY,
       user_id           text        NOT NULL REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE,
       suspended_at      timestamptz,
       suspended_reason  text,
       banned_at         timestamptz,
       banned_reason     text,
       ban_expires_at    timestamptz,
       created_at        timestamptz NOT NULL DEFAULT now(),
       updated_at        timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_user_security_user_idx"
       ON "_briven_auth_user_security" (user_id)`,

    // ─── Waitlist (Phase 1 — waitlist mode) ─────────────────────────────────
    `CREATE TABLE IF NOT EXISTS "_briven_auth_waitlist" (
       id               text        PRIMARY KEY,
       email            text        NOT NULL,
       name             text,
       status           text        NOT NULL DEFAULT 'pending',
       approved_at      timestamptz,
       approved_by      text,
       rejected_at      timestamptz,
       rejected_reason  text,
       created_at       timestamptz NOT NULL DEFAULT now(),
       updated_at       timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_waitlist_email_idx"
       ON "_briven_auth_waitlist" (email)`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_waitlist_status_idx"
       ON "_briven_auth_waitlist" (status)`,

    // ─── Session Activity (Phase 2 — inactivity timeout) ────────────────────
    `CREATE TABLE IF NOT EXISTS "_briven_auth_session_activity" (
       id             text        PRIMARY KEY,
       session_id     text        NOT NULL REFERENCES "_briven_auth_sessions"(id) ON DELETE CASCADE,
       last_active_at timestamptz NOT NULL DEFAULT now(),
       created_at     timestamptz NOT NULL DEFAULT now(),
       updated_at     timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_session_activity_session_idx"
       ON "_briven_auth_session_activity" (session_id)`,

    // ─── Device Tracking (Gap Fix #6) ───────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS "_briven_auth_devices" (
       id            text        PRIMARY KEY,
       user_id       text        NOT NULL REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE,
       fingerprint   text        NOT NULL,
       user_agent    text,
       created_at    timestamptz NOT NULL DEFAULT now(),
       updated_at    timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_devices_user_fingerprint_uniq"
       ON "_briven_auth_devices" (user_id, fingerprint)`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_devices_user_idx"
       ON "_briven_auth_devices" (user_id)`,

    // ─── User Metadata (Phase 3) ────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS "_briven_auth_user_metadata" (
       id                text        PRIMARY KEY,
       user_id           text        NOT NULL REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE,
       public_metadata   jsonb       NOT NULL DEFAULT '{}'::jsonb,
       private_metadata  jsonb       NOT NULL DEFAULT '{}'::jsonb,
       created_at        timestamptz NOT NULL DEFAULT now(),
       updated_at        timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_user_metadata_user_idx"
       ON "_briven_auth_user_metadata" (user_id)`,

    // ─── User Emails (Phase 3 — multiple emails per user) ───────────────────
    `CREATE TABLE IF NOT EXISTS "_briven_auth_user_emails" (
       id         text        PRIMARY KEY,
       user_id    text        NOT NULL REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE,
       email      text        NOT NULL,
       verified   boolean     NOT NULL DEFAULT false,
       primary    boolean     NOT NULL DEFAULT false,
       created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_user_emails_user_email_uniq"
       ON "_briven_auth_user_emails" (user_id, email)`,

    // ─── Sign-in Tokens (Phase 3 — single-use programmatic session creation)
    `CREATE TABLE IF NOT EXISTS "_briven_auth_signin_tokens" (
       id          text        PRIMARY KEY,
       user_id     text        NOT NULL REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE,
       token_hash  text        NOT NULL,
       expires_at  timestamptz NOT NULL,
       used_at     timestamptz,
       created_at  timestamptz NOT NULL DEFAULT now(),
       updated_at  timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_signin_tokens_hash_uniq"
       ON "_briven_auth_signin_tokens" (token_hash)`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_signin_tokens_user_idx"
       ON "_briven_auth_signin_tokens" (user_id)`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_signin_tokens_expires_idx"
       ON "_briven_auth_signin_tokens" (expires_at)`,

    // ─── Organization Roles (Phase 4 — custom roles & permissions)
    `CREATE TABLE IF NOT EXISTS "_briven_auth_org_roles" (
       id          text        PRIMARY KEY,
       org_id      text        NOT NULL REFERENCES "_briven_auth_orgs"(id) ON DELETE CASCADE,
       name        text        NOT NULL,
       permissions jsonb       NOT NULL DEFAULT '[]'::jsonb,
       is_system   boolean     NOT NULL DEFAULT false,
       created_at  timestamptz NOT NULL DEFAULT now(),
       updated_at  timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_org_roles_org_name_uniq"
       ON "_briven_auth_org_roles" (org_id, name)`,

    // ─── Organization Domains (Phase 4 — domain verification + auto-join)
    `CREATE TABLE IF NOT EXISTS "_briven_auth_org_domains" (
       id                 text        PRIMARY KEY,
       org_id             text        NOT NULL REFERENCES "_briven_auth_orgs"(id) ON DELETE CASCADE,
       domain             text        NOT NULL,
       verification_token text        NOT NULL,
       verified_at        timestamptz,
       auto_join_enabled  boolean     NOT NULL DEFAULT false,
       created_at         timestamptz NOT NULL DEFAULT now(),
       updated_at         timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_org_domains_org_domain_uniq"
       ON "_briven_auth_org_domains" (org_id, domain)`,

    // ─── Organization Membership Requests (Phase 4 — request to join)
    `CREATE TABLE IF NOT EXISTS "_briven_auth_org_membership_requests" (
       id           text        PRIMARY KEY,
       org_id       text        NOT NULL REFERENCES "_briven_auth_orgs"(id) ON DELETE CASCADE,
       user_id      text        NOT NULL REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE,
       status       text        NOT NULL DEFAULT 'pending',
       message      text,
       requested_at timestamptz NOT NULL DEFAULT now(),
       resolved_at  timestamptz,
       resolved_by  text        REFERENCES "_briven_auth_users"(id) ON DELETE SET NULL,
       created_at   timestamptz NOT NULL DEFAULT now(),
       updated_at   timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_org_membership_requests_org_user_uniq"
       ON "_briven_auth_org_membership_requests" (org_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_org_membership_requests_org_status_idx"
       ON "_briven_auth_org_membership_requests" (org_id, status)`,

    // ─── Session Active Organization (Phase 4 — org switch without re-auth)
    `CREATE TABLE IF NOT EXISTS "_briven_auth_session_orgs" (
       id         text        PRIMARY KEY,
       session_id text        NOT NULL REFERENCES "_briven_auth_sessions"(id) ON DELETE CASCADE,
       org_id     text        NOT NULL REFERENCES "_briven_auth_orgs"(id) ON DELETE CASCADE,
       created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_session_orgs_session_uniq"
       ON "_briven_auth_session_orgs" (session_id)`,

    // ─── Enterprise SSO Connections (Phase 5 — SAML + OIDC)
    `CREATE TABLE IF NOT EXISTS "_briven_auth_sso_connections" (
       id              text        PRIMARY KEY,
       name            text        NOT NULL,
       provider_type   text        NOT NULL,
       config          jsonb       NOT NULL DEFAULT '{}'::jsonb,
       domains         jsonb       NOT NULL DEFAULT '[]'::jsonb,
       jit_enabled     boolean     NOT NULL DEFAULT true,
       deactivated_at  timestamptz,
       created_at      timestamptz NOT NULL DEFAULT now(),
       updated_at      timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_sso_connections_name_idx"
       ON "_briven_auth_sso_connections" (name)`,

    // ─── SSO Session Tracking (Phase 5 — deprovisioning)
    `CREATE TABLE IF NOT EXISTS "_briven_auth_sso_sessions" (
       id            text        PRIMARY KEY,
       session_id    text        NOT NULL REFERENCES "_briven_auth_sessions"(id) ON DELETE CASCADE,
       connection_id text        NOT NULL REFERENCES "_briven_auth_sso_connections"(id) ON DELETE CASCADE,
       created_at    timestamptz NOT NULL DEFAULT now(),
       updated_at    timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_sso_sessions_session_uniq"
       ON "_briven_auth_sso_sessions" (session_id)`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_sso_sessions_conn_idx"
       ON "_briven_auth_sso_sessions" (connection_id)`,

    // ─── Impersonation Sessions (Phase 6.2 — support impersonation audit)
    `CREATE TABLE IF NOT EXISTS "_briven_auth_impersonation_sessions" (
       id               text        PRIMARY KEY,
       session_id       text        NOT NULL REFERENCES "_briven_auth_sessions"(id) ON DELETE CASCADE,
       impersonated_by  text        NOT NULL,
       target_user_id   text        NOT NULL,
       stopped_at       timestamptz,
       created_at       timestamptz NOT NULL DEFAULT now(),
       updated_at       timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_impersonation_sessions_session_uniq"
       ON "_briven_auth_impersonation_sessions" (session_id)`,

    // ─── Application Logs (Phase 6.3 — structured operational logs)
    `CREATE TABLE IF NOT EXISTS "_briven_auth_app_logs" (
       id          text        PRIMARY KEY,
       level       text        NOT NULL,
       action      text        NOT NULL,
       message     text        NOT NULL,
       metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
       created_at  timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_app_logs_level_created_idx"
       ON "_briven_auth_app_logs" (level, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_app_logs_action_created_idx"
       ON "_briven_auth_app_logs" (action, created_at DESC)`,

    // ─── Compliance Metadata (Phase 6.6 — SOC 2 / HIPAA / GDPR)
    `CREATE TABLE IF NOT EXISTS "_briven_auth_compliance" (
       id                        text        PRIMARY KEY,
       soc2_controls_url         text,
       hipaa_baa_signed_at       timestamptz,
       hipaa_baa_signed_by       text,
       gdpr_dpa_signed_at        timestamptz,
       gdpr_dpa_signed_by        text,
       encryption_at_rest_enabled boolean     NOT NULL DEFAULT true,
       created_at                timestamptz NOT NULL DEFAULT now(),
       updated_at                timestamptz NOT NULL DEFAULT now()
     )`,

    // ─── JWT Templates (Phase 7.1 — named claim sets for custom tokens)
    `CREATE TABLE IF NOT EXISTS "_briven_auth_jwt_templates" (
       id         text        PRIMARY KEY,
       name       text        NOT NULL,
       claims     jsonb       NOT NULL DEFAULT '{}'::jsonb,
       created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_jwt_templates_name_uniq"
       ON "_briven_auth_jwt_templates" (name)`,

    // ─── Custom JWT Signing Keys (Phase 7.1 — independent from Better Auth jwks)
    `CREATE TABLE IF NOT EXISTS "_briven_auth_custom_jwks" (
       id          text        PRIMARY KEY,
       public_key  text        NOT NULL,
       private_key text        NOT NULL,
       created_at  timestamptz NOT NULL DEFAULT now(),
       expires_at  timestamptz
     )`,

    // ─── User Usernames (Phase 7.3 — username-based authentication)
    `CREATE TABLE IF NOT EXISTS "_briven_auth_user_usernames" (
       id         text        PRIMARY KEY,
       user_id    text        NOT NULL REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE,
       username   text        NOT NULL,
       created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_user_usernames_username_uniq"
       ON "_briven_auth_user_usernames" (username)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_user_usernames_user_idx"
       ON "_briven_auth_user_usernames" (user_id)`,

    // ─── Testing Tokens (Phase 7.4 — E2E test bypass tokens)
    `CREATE TABLE IF NOT EXISTS "_briven_auth_test_tokens" (
       id          text        PRIMARY KEY,
       user_id     text        NOT NULL REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE,
       token_hash  text        NOT NULL,
       name        text,
       expires_at  timestamptz NOT NULL,
       created_at  timestamptz NOT NULL DEFAULT now(),
       updated_at  timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_test_tokens_hash_uniq"
       ON "_briven_auth_test_tokens" (token_hash)`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_test_tokens_user_idx"
       ON "_briven_auth_test_tokens" (user_id)`,

    // ─── Email Templates (Phase 7.5 — per-tenant transactional email overrides)
    `CREATE TABLE IF NOT EXISTS "_briven_auth_email_templates" (
       id         text        PRIMARY KEY,
       name       text        NOT NULL,
       subject    text        NOT NULL,
       html       text        NOT NULL,
       text       text,
       active     boolean     NOT NULL DEFAULT true,
       created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_email_templates_name_uniq"
       ON "_briven_auth_email_templates" (name)`,

    // ─── OIDC State Store (Gap Fix #3 — OIDC enterprise authorization flow)
    `CREATE TABLE IF NOT EXISTS "_briven_auth_oidc_states" (
       id            text        PRIMARY KEY,
       state         text        NOT NULL,
       nonce         text        NOT NULL,
       connection_id text        NOT NULL,
       expires_at    timestamptz NOT NULL,
       created_at    timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_oidc_states_state_uniq"
       ON "_briven_auth_oidc_states" (state)`,

    // ─── Password Policy (Gap Fix #13 — password complexity & expiration)
    `CREATE TABLE IF NOT EXISTS "_briven_auth_password_policy" (
       id                text        PRIMARY KEY,
       min_length        bigint      NOT NULL DEFAULT 8,
       require_uppercase boolean     NOT NULL DEFAULT false,
       require_lowercase boolean     NOT NULL DEFAULT false,
       require_number    boolean     NOT NULL DEFAULT false,
       require_special   boolean     NOT NULL DEFAULT false,
       max_age_days      bigint,
       prevent_reuse     bigint      NOT NULL DEFAULT 0,
       created_at        timestamptz NOT NULL DEFAULT now(),
       updated_at        timestamptz NOT NULL DEFAULT now()
     )`,

    // ─── Password History (Gap Fix #13 — prevent password reuse)
    `CREATE TABLE IF NOT EXISTS "_briven_auth_password_history" (
       id            text        PRIMARY KEY,
       user_id       text        NOT NULL REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE,
       password_hash text        NOT NULL,
       created_at    timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_password_history_user_idx"
       ON "_briven_auth_password_history" (user_id)`,

  ].map((stmt) => stmt.replace(/\s+/g, ' ').trim());
}

/**
 * Names of every table this emitter creates. Useful for the "is auth
 * provisioned?" probe + for the `disable` endpoint's drop-without-data
 * path (which intentionally does NOT drop — disable just flips the
 * meta flag).
 */
export const AUTH_TABLES = [
  '_briven_auth_users',
  '_briven_auth_sessions',
  '_briven_auth_accounts',
  '_briven_auth_verification_tokens',
  '_briven_auth_audit_log',
  '_briven_auth_jwks',
  '_briven_auth_orgs',
  '_briven_auth_org_members',
  '_briven_auth_org_invites',
  '_briven_auth_two_factors',
  '_briven_auth_passkeys',
  '_briven_auth_user_security',
  '_briven_auth_waitlist',
  '_briven_auth_session_activity',
  '_briven_auth_devices',
  '_briven_auth_user_metadata',
  '_briven_auth_user_emails',
  '_briven_auth_signin_tokens',
  '_briven_auth_org_roles',
  '_briven_auth_org_domains',
  '_briven_auth_org_membership_requests',
  '_briven_auth_session_orgs',
  '_briven_auth_sso_connections',
  '_briven_auth_sso_sessions',
  '_briven_auth_impersonation_sessions',
  '_briven_auth_app_logs',
  '_briven_auth_compliance',
  '_briven_auth_jwt_templates',
  '_briven_auth_custom_jwks',
  '_briven_auth_user_usernames',
  '_briven_auth_test_tokens',
  '_briven_auth_email_templates',
  '_briven_auth_oidc_states',
  '_briven_auth_password_policy',
  '_briven_auth_password_history',
] as const;
export type AuthTableName = (typeof AUTH_TABLES)[number];
