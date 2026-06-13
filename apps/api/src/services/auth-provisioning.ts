/**
 * SQL emitter for the briven auth customer-schema tables.
 *
 * Called once per project, the first time a customer clicks **Enable Auth**
 * in the dashboard. Emits a single transactional batch of statements that:
 *   1. ensures the `citext` extension exists in the project's schema
 *   2. creates the five `_briven_auth_*` tables
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
 * Emit the full DDL batch for a project's auth tables. Caller wraps in a
 * transaction and runs inside `runInProjectSchema(projectId, tx)` so
 * `search_path` points at `proj_<projectId>`.
 */
export function renderAuthProvisioningSql(): string[] {
  return [
    // citext for case-insensitive email matching. The extension is per-schema
    // on Postgres 17 when installed inside a SET search_path session, which
    // is exactly the context the caller establishes.
    `CREATE EXTENSION IF NOT EXISTS citext`,

    // _briven_auth_users
    `CREATE TABLE IF NOT EXISTS "_briven_auth_users" (
       id              text        PRIMARY KEY,
       email           citext      NOT NULL,
       email_verified  timestamptz,
       name            text,
       image           text,
       created_at      timestamptz NOT NULL DEFAULT now(),
       updated_at      timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_users_email_uniq"
       ON "_briven_auth_users" (email)`,

    // _briven_auth_sessions
    `CREATE TABLE IF NOT EXISTS "_briven_auth_sessions" (
       id               text        PRIMARY KEY,
       user_id          text        NOT NULL REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE,
       token            text        NOT NULL,
       expires_at       timestamptz NOT NULL,
       ip_address_hash  text,
       user_agent       text,
       created_at       timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_sessions_token_uniq"
       ON "_briven_auth_sessions" (token)`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_sessions_user_idx"
       ON "_briven_auth_sessions" (user_id)`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_sessions_expires_idx"
       ON "_briven_auth_sessions" (expires_at)`,

    // _briven_auth_accounts
    `CREATE TABLE IF NOT EXISTS "_briven_auth_accounts" (
       id                       text        PRIMARY KEY,
       user_id                  text        NOT NULL REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE,
       provider_id              text        NOT NULL,
       provider_account_id      text        NOT NULL,
       refresh_token_encrypted  text,
       access_token_encrypted   text,
       scope                    text,
       created_at               timestamptz NOT NULL DEFAULT now(),
       updated_at               timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_accounts_provider_pair_uniq"
       ON "_briven_auth_accounts" (provider_id, provider_account_id)`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_accounts_user_idx"
       ON "_briven_auth_accounts" (user_id)`,

    // _briven_auth_verification_tokens
    `CREATE TABLE IF NOT EXISTS "_briven_auth_verification_tokens" (
       id           text        PRIMARY KEY,
       identifier   text        NOT NULL,
       value_hash   text        NOT NULL,
       type         text        NOT NULL,
       expires_at   timestamptz NOT NULL,
       consumed_at  timestamptz,
       created_at   timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS "_briven_auth_verif_identifier_type_idx"
       ON "_briven_auth_verification_tokens" (identifier, type)`,
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
] as const;
export type AuthTableName = (typeof AUTH_TABLES)[number];
