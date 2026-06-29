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
       id              text        PRIMARY KEY,
       name            text,
       email           text        NOT NULL,
       email_verified  boolean     NOT NULL DEFAULT false,
       image           text,
       created_at      timestamptz NOT NULL DEFAULT now(),
       updated_at      timestamptz NOT NULL DEFAULT now()
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
    // Covering index for the MAU distinct-count (services/auth-mau.ts):
    //   COUNT(DISTINCT user_id) WHERE created_at >= <month start>.
    // Leading on created_at lets the planner range-scan the month instead
    // of a full table scan; including user_id makes it index-only.
    // NOTE: this is emitted for NEW provisions only. Tenant DBs provisioned
    // before this change need a ONE-TIME backfill (run per existing tenant
    // DB, not as a cross-tenant control-plane migration):
    //   CREATE INDEX IF NOT EXISTS "_briven_auth_sessions_created_at_idx"
    //     ON "_briven_auth_sessions" (created_at, user_id);
    `CREATE INDEX IF NOT EXISTS "_briven_auth_sessions_created_at_idx"
       ON "_briven_auth_sessions" (created_at, user_id)`,

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
