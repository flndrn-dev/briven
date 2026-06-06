/**
 * Drizzle models for briven auth's customer-schema tables.
 *
 * These tables live in each project's data-plane database (`proj_<projectId>`),
 * not in the control-plane meta-DB. The Better Auth Drizzle adapter consumes
 * these models per-tenant — see `apps/api/src/services/auth-tenant-pool.ts`
 * (BUILD_PLAN.md §13 step 3).
 *
 * Naming + shape comes verbatim from BUILD_PLAN.md §3. The `_briven_auth_`
 * prefix matches the existing `_briven_*` reserved namespace so customer
 * code cannot shadow these tables and they survive customer schema diffs.
 *
 * Binary fields (ip hashes, token hashes, encrypted refresh tokens) are
 * stored as base64 strings in `text` columns — same pattern as
 * `apps/api/src/services/project-env.ts`. Keeps the wire format consistent
 * across services without pulling in `customType<Buffer>`.
 *
 * Provisioning: the customer's first **Enable Auth** click triggers a
 * single transactional migration that emits the CREATE TABLE statements
 * derived from these models, then records the applied migration in
 * `_briven_migrations` like every other schema apply.
 *
 * @README-DOLT ADR 0001 — migrated from pg-core to mysql-core.
 *
 *   - `pgTable` → `mysqlTable`
 *   - `text('id').primaryKey()` → `varchar('id', { length: 36 }).primaryKey()`
 *   - `timestamp(..., { withTimezone: true, mode: 'date' })` →
 *     `timestamp(..., { mode: 'date', fsp: 3 })`
 *   - `jsonb` → `json`
 *   - `citext` extension is Postgres-only; MySQL `utf8mb4_unicode_ci` collation
 *     on the `email` column provides case-insensitive comparison.
 */

import { index, json, mysqlTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

// Shared helpers — mirror the conventions in apps/api/src/db/schema.ts.
const id = () => varchar('id', { length: 36 }).primaryKey();
const ts = (name: string) => timestamp(name, { mode: 'date', fsp: 3 });

/**
 * Authenticated end-users of a customer's project. One row per unique
 * email within the tenant. `email` uses `utf8mb4_unicode_ci` collation
 * at the MySQL level for case-insensitive comparison — Drizzle treats
 * it as `text` for query typing; the CREATE TABLE step (in the
 * provisioning emitter) ensures the underlying column uses the
 * correct collation.
 */
export const authUsers = mysqlTable(
  '_briven_auth_users',
  {
    id: id(),
    email: text('email').notNull(),
    emailVerified: ts('email_verified'), // null = unverified
    name: text('name'),
    image: text('image'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    emailUniq: uniqueIndex('_briven_auth_users_email_uniq').on(t.email),
  }),
);

/**
 * Active sessions. `token` is opaque (32 bytes random, urlsafe-base64);
 * `ipAddressHash` is sha-256 digest base64-encoded — the raw IP is never
 * persisted (CLAUDE.md §5.1).
 */
export const authSessions = mysqlTable(
  '_briven_auth_sessions',
  {
    id: id(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: ts('expires_at').notNull(),
    ipAddressHash: text('ip_address_hash'), // base64 sha-256, never raw
    userAgent: text('user_agent'), // bounded to 512 chars at insert time
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => ({
    tokenUniq: uniqueIndex('_briven_auth_sessions_token_uniq').on(t.token),
    userIdx: index('_briven_auth_sessions_user_idx').on(t.userId),
    expiresIdx: index('_briven_auth_sessions_expires_idx').on(t.expiresAt),
  }),
);

/**
 * Linked OAuth accounts. Refresh + access tokens are encrypted at rest
 * using the per-tenant key derived in `services/tenant-secret-store.ts`.
 * Stored as base64 of `<iv> || <tag> || <ciphertext>` — same wire format
 * as project-env. The unique constraint on (providerId, providerAccountId)
 * prevents account collisions across users within a tenant.
 */
export const authAccounts = mysqlTable(
  '_briven_auth_accounts',
  {
    id: id(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    accessTokenEncrypted: text('access_token_encrypted'),
    scope: text('scope'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    providerPairUniq: uniqueIndex('_briven_auth_accounts_provider_pair_uniq').on(
      t.providerId,
      t.providerAccountId,
    ),
    userIdx: index('_briven_auth_accounts_user_idx').on(t.userId),
  }),
);

/**
 * One-shot verification tokens — magic links, email OTP codes, password
 * resets, email-claim links. The raw token never persists: only its
 * sha-256 digest (base64) is stored. `consumedAt` is null until the
 * token is redeemed; one redemption flips it to the timestamp and the
 * verification middleware refuses subsequent uses.
 */
export const authVerificationTokens = mysqlTable(
  '_briven_auth_verification_tokens',
  {
    id: id(),
    identifier: text('identifier').notNull(), // email for magic-link/OTP
    valueHash: text('value_hash').notNull(),
    type: text('type').notNull(), // 'magic_link' | 'otp' | 'password_reset' | 'email_verify'
    expiresAt: ts('expires_at').notNull(),
    consumedAt: ts('consumed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => ({
    identifierTypeIdx: index('_briven_auth_verif_identifier_type_idx').on(t.identifier, t.type),
    expiresIdx: index('_briven_auth_verif_expires_idx').on(t.expiresAt),
  }),
);

/**
 * Append-only audit log of every authentication event within this tenant.
 * Action vocabulary: signup, signin, signout, session.revoked,
 * account.linked, account.unlinked, password.reset, admin.* (admin actions
 * also write a mirror row to the control-plane `audit_logs` table — cross-DB
 * audit redundancy is intentional).
 *
 * `metadata` is a small json blob carrying context that doesn't deserve
 * its own column (provider id on signin events, reason on
 * session.revoked, etc.). Never includes raw IPs or full emails —
 * CLAUDE.md §5.1 redaction applies here too.
 */
export const authAuditLog = mysqlTable(
  '_briven_auth_audit_log',
  {
    id: id(),
    userId: varchar('user_id', { length: 36 }).references(() => authUsers.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    ipAddressHash: text('ip_address_hash'),
    userAgent: text('user_agent'),
    metadata: json('metadata').notNull().default({}),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => ({
    userOccurredIdx: index('_briven_auth_audit_user_occurred_idx').on(t.userId, t.occurredAt),
    actionOccurredIdx: index('_briven_auth_audit_action_occurred_idx').on(t.action, t.occurredAt),
  }),
);

/**
 * Better Auth model-name mapping. The engine ships with singular model
 * names; we map them onto our pluralised, prefixed tables when
 * instantiating per-tenant. The customer-facing service router consumes
 * this directly via the Drizzle adapter — see step 3 of the build plan.
 */
export const authSchema = {
  user: authUsers,
  session: authSessions,
  account: authAccounts,
  verification: authVerificationTokens,
  // briven-specific extra — Better Auth doesn't ship an audit-log model,
  // so the auth service writes to this directly.
  auditLog: authAuditLog,
} as const;

export type AuthUser = typeof authUsers.$inferSelect;
export type AuthSession = typeof authSessions.$inferSelect;
export type AuthAccount = typeof authAccounts.$inferSelect;
export type AuthVerificationToken = typeof authVerificationTokens.$inferSelect;
export type AuthAuditLogEntry = typeof authAuditLog.$inferSelect;

/** Audit-action vocabulary. Open union — services can emit any string,
 *  but the listed values are guaranteed to be handled by the admin
 *  dashboard's filter UI without extra wiring. */
export const AUTH_AUDIT_ACTIONS = [
  'signup',
  'signin',
  'signout',
  'session.revoked',
  'account.linked',
  'account.unlinked',
  'password.reset',
  'email.verified',
] as const;
export type AuthAuditAction = (typeof AUTH_AUDIT_ACTIONS)[number] | (string & {});

/** Verification-token type vocabulary. */
export const AUTH_VERIFICATION_TYPES = [
  'magic_link',
  'otp',
  'password_reset',
  'email_verify',
] as const;
export type AuthVerificationTypeValue = (typeof AUTH_VERIFICATION_TYPES)[number] | (string & {});
