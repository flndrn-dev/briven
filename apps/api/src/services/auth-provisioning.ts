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
] as const;
export type AuthTableName = (typeof AUTH_TABLES)[number];
