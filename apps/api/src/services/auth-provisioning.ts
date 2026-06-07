/**
 * SQL emitter for the briven auth customer-schema tables.
 *
 * Called once per project, the first time a customer clicks **Enable Auth**
 * in the dashboard. Emits a single transactional batch of statements that
 * creates the five `_briven_auth_*` tables with supporting indexes.
 *
 * Shape matches BUILD_PLAN.md §3 exactly. Drizzle model definitions live
 * at `apps/api/src/db/auth-customer-schema.ts` and stay the source of
 * truth for application-layer reads; this emitter is the source of truth
 * for the DDL that lands in the customer database.
 *
 * Why not run drizzle-kit migrate? Customer databases are dynamic — one
 * per project — and drizzle-kit's snapshot/diff workflow is built for a
 * fixed schema set. Hand-emitting the DDL keeps the provisioning step
 * idempotent (IF NOT EXISTS everywhere) and free of the drizzle-kit TTY
 * blocker tracked in road-to-ga.md §2.9.
 *
 * Idempotency: every statement is `IF NOT EXISTS`. Re-running on an
 * already-provisioned database is a no-op, which matters because the
 * provisioning route is idempotent by design (BUILD_PLAN.md §4 admin
 * endpoint `POST /v1/projects/:id/auth/enable`).
 *
 * @README-BRIVEN Phase 3: migrated from Postgres DDL to MySQL DDL.
 *   - `CREATE EXTENSION citext` → removed (collation set per-column)
 *   - `text PRIMARY KEY` → `VARCHAR(36) PRIMARY KEY`
 *   - `citext` → `VARCHAR(255) COLLATE utf8mb4_unicode_ci`
 *   - `timestamptz` → `TIMESTAMP(3)`
 *   - `jsonb` → `JSON`
 *   - `'{}'::jsonb` → `(JSON_OBJECT())`
 *   - `"..."` identifier quoting → `` `...` ``
 *   - `now()` → `CURRENT_TIMESTAMP(3)`
 */

/**
 * Emit the full DDL batch for a project's auth tables. Caller wraps in a
 * transaction and runs inside `runInProjectSchema(projectId, conn)` so
 * the connection's current database is `proj_<projectId>`.
 */
export function renderAuthProvisioningSql(): string[] {
  return [
    // _briven_auth_users
    // email uses utf8mb4_unicode_ci for case-insensitive matching — the
    // MySQL equivalent of Postgres citext.
    `CREATE TABLE IF NOT EXISTS \`_briven_auth_users\` (
       id              VARCHAR(36)  PRIMARY KEY,
       email           VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci,
       email_verified  TIMESTAMP(3),
       name            TEXT,
       image           TEXT,
       created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       updated_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS \`_briven_auth_users_email_uniq\`
       ON \`_briven_auth_users\` (email)`,

    // _briven_auth_sessions
    `CREATE TABLE IF NOT EXISTS \`_briven_auth_sessions\` (
       id               VARCHAR(36)  PRIMARY KEY,
       user_id          VARCHAR(36)  NOT NULL,
       token            TEXT         NOT NULL,
       expires_at       TIMESTAMP(3) NOT NULL,
       ip_address_hash  TEXT,
       user_agent       TEXT,
       created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       CONSTRAINT \`_briven_auth_sessions_user_fk\`
         FOREIGN KEY (user_id) REFERENCES \`_briven_auth_users\`(id) ON DELETE CASCADE
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS \`_briven_auth_sessions_token_uniq\`
       ON \`_briven_auth_sessions\` (token(255))`,
    `CREATE INDEX IF NOT EXISTS \`_briven_auth_sessions_user_idx\`
       ON \`_briven_auth_sessions\` (user_id)`,
    `CREATE INDEX IF NOT EXISTS \`_briven_auth_sessions_expires_idx\`
       ON \`_briven_auth_sessions\` (expires_at)`,

    // _briven_auth_accounts
    `CREATE TABLE IF NOT EXISTS \`_briven_auth_accounts\` (
       id                       VARCHAR(36)  PRIMARY KEY,
       user_id                  VARCHAR(36)  NOT NULL,
       provider_id              TEXT         NOT NULL,
       provider_account_id      TEXT         NOT NULL,
       refresh_token_encrypted  TEXT,
       access_token_encrypted   TEXT,
       scope                    TEXT,
       created_at               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       updated_at               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       CONSTRAINT \`_briven_auth_accounts_user_fk\`
         FOREIGN KEY (user_id) REFERENCES \`_briven_auth_users\`(id) ON DELETE CASCADE
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS \`_briven_auth_accounts_provider_pair_uniq\`
       ON \`_briven_auth_accounts\` (provider_id(128), provider_account_id(128))`,
    `CREATE INDEX IF NOT EXISTS \`_briven_auth_accounts_user_idx\`
       ON \`_briven_auth_accounts\` (user_id)`,

    // _briven_auth_verification_tokens
    `CREATE TABLE IF NOT EXISTS \`_briven_auth_verification_tokens\` (
       id           VARCHAR(36)  PRIMARY KEY,
       identifier   TEXT         NOT NULL,
       value_hash   TEXT         NOT NULL,
       type         VARCHAR(32)  NOT NULL,
       expires_at   TIMESTAMP(3) NOT NULL,
       consumed_at  TIMESTAMP(3),
       created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
     )`,
    `CREATE INDEX IF NOT EXISTS \`_briven_auth_verif_identifier_type_idx\`
       ON \`_briven_auth_verification_tokens\` (identifier(128), type)`,
    `CREATE INDEX IF NOT EXISTS \`_briven_auth_verif_expires_idx\`
       ON \`_briven_auth_verification_tokens\` (expires_at)`,

    // _briven_auth_audit_log
    `CREATE TABLE IF NOT EXISTS \`_briven_auth_audit_log\` (
       id               VARCHAR(36)  PRIMARY KEY,
       user_id          VARCHAR(36),
       action           TEXT         NOT NULL,
       ip_address_hash  TEXT,
       user_agent       TEXT,
       metadata         JSON         NOT NULL DEFAULT (JSON_OBJECT()),
       occurred_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       CONSTRAINT \`_briven_auth_audit_log_user_fk\`
         FOREIGN KEY (user_id) REFERENCES \`_briven_auth_users\`(id) ON DELETE SET NULL
     )`,
    `CREATE INDEX IF NOT EXISTS \`_briven_auth_audit_user_occurred_idx\`
       ON \`_briven_auth_audit_log\` (user_id, occurred_at)`,
    `CREATE INDEX IF NOT EXISTS \`_briven_auth_audit_action_occurred_idx\`
       ON \`_briven_auth_audit_log\` (action(64), occurred_at)`,
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
