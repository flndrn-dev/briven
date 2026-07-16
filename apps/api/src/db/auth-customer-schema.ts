/**
 * Drizzle models for briven auth's customer-schema tables.
 *
 * These tables live in each project's own DoltGres DATABASE (`proj_<id>`,
 * database-per-project), in the `public` schema. The Better Auth Drizzle
 * adapter consumes the user/session/account/verification models per-tenant —
 * see `apps/api/src/services/auth-tenant-pool.ts`.
 *
 * IMPORTANT (sprint S2.1b): these four models are deliberately shaped to match
 * **Better Auth's** core schema (field/property names + types it reads/writes),
 * because the Drizzle adapter looks columns up by the model's property names.
 * The earlier NextAuth-style shape (emailVerified as a timestamp, no
 * account.password, verification.valueHash) did not match Better Auth, so
 * sign-up/sign-in 500'd. Property names here therefore mirror Better Auth:
 *   user:    id, name, email, emailVerified(boolean), image, createdAt, updatedAt
 *   session: id, userId, token, expiresAt, ipAddress, userAgent, createdAt, updatedAt
 *   account: id, userId, accountId, providerId, accessToken, refreshToken,
 *            idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope,
 *            password, createdAt, updatedAt
 *   verification: id, identifier, value, expiresAt, createdAt, updatedAt
 *
 * `_briven_auth_audit_log` is briven's own (Better Auth has no audit model);
 * it is NOT passed to the adapter and keeps its original shape.
 *
 * The physical DDL is hand-emitted by `services/auth-provisioning.ts` (kept in
 * sync with these models). DoltGres notes: no `citext` (email is text + a
 * UNIQUE index on lower(email)); no `CREATE EXTENSION`.
 */

import { bigint, boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// Shared helpers — mirror the conventions in apps/api/src/db/schema.ts.
const id = () => text('id').primaryKey();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Authenticated end-users of a customer's project. One row per unique email
 * within the tenant. `email` is `text`; case-insensitive uniqueness is enforced
 * by a UNIQUE index on `lower(email)` in the provisioning DDL (DoltGres has no
 * citext). `emailVerified` is a BOOLEAN — what Better Auth expects.
 */
export const authUsers = pgTable(
  '_briven_auth_users',
  {
    id: id(),
    name: text('name'),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    // Cosmetic for query typing; the real (lower(email)) unique index lives in
    // the provisioning DDL.
    emailUniq: uniqueIndex('_briven_auth_users_email_uniq').on(t.email),
  }),
);

/**
 * Active sessions. `token` is opaque. Better Auth manages these rows.
 * `ipAddress` exists for Better Auth compatibility but IP tracking is disabled
 * (privacy — CLAUDE.md §5.1), so it stays null in practice.
 */
export const authSessions = pgTable(
  '_briven_auth_sessions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: ts('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    tokenUniq: uniqueIndex('_briven_auth_sessions_token_uniq').on(t.token),
    userIdx: index('_briven_auth_sessions_user_idx').on(t.userId),
    expiresIdx: index('_briven_auth_sessions_expires_idx').on(t.expiresAt),
  }),
);

/**
 * Linked accounts — both the email/password "credential" account (password
 * hash in `password`) and, later, OAuth accounts (tokens in access/refresh/
 * idToken). Shaped to Better Auth's account model. OAuth is not wired in v1, so
 * the token columns are unused-but-present. Uniqueness is per (providerId,
 * accountId) — Better Auth's natural key.
 */
export const authAccounts = pgTable(
  '_briven_auth_accounts',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    providerPairUniq: uniqueIndex('_briven_auth_accounts_provider_pair_uniq').on(
      t.providerId,
      t.accountId,
    ),
    userIdx: index('_briven_auth_accounts_user_idx').on(t.userId),
  }),
);

/**
 * Verification rows — magic links, email OTP, password resets, email-verify.
 * Better Auth creates and consumes these directly, so the shape is Better
 * Auth's: `{ identifier, value, expiresAt }`.
 */
export const authVerificationTokens = pgTable(
  '_briven_auth_verification_tokens',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    identifierIdx: index('_briven_auth_verif_identifier_idx').on(t.identifier),
    expiresIdx: index('_briven_auth_verif_expires_idx').on(t.expiresAt),
  }),
);

/**
 * JWT signing keys — Better Auth's jwt-plugin `jwks` model. One row per
 * generated key pair; the plugin creates the first row lazily on the first
 * `/token` or `/jwks` request. `privateKey` holds the private JWK encrypted
 * by Better Auth with the instance secret (ciphertext JSON, never a raw
 * key); `publicKey` is the public JWK served on `GET /v1/auth-tenant/jwks`.
 * Field names mirror the plugin's schema exactly: publicKey, privateKey,
 * createdAt (required), expiresAt (optional, key rotation).
 */
export const authJwks = pgTable('_briven_auth_jwks', {
  id: id(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at'),
});

/**
 * Append-only audit log of authentication events within this tenant. Briven's
 * own table (Better Auth has no audit model), unchanged by the S2.1b rebuild.
 * `metadata` never includes raw IPs or full emails — CLAUDE.md §5.1.
 */
export const authAuditLog = pgTable(
  '_briven_auth_audit_log',
  {
    id: id(),
    userId: text('user_id').references(() => authUsers.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    ipAddressHash: text('ip_address_hash'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => ({
    userOccurredIdx: index('_briven_auth_audit_user_occurred_idx').on(t.userId, t.occurredAt),
    actionOccurredIdx: index('_briven_auth_audit_action_occurred_idx').on(t.action, t.occurredAt),
  }),
);

/**
 * Better Auth model-name mapping. The engine ships with singular model names;
 * we map them onto our prefixed tables when instantiating per-tenant.
 */
/**
 * Organizations — customer-facing multi-tenant teams (Phase 2).
 * These are NOT Better Auth models; they are briven-specific extensions
 * that customer apps use for org/team management.
 */
export const authOrgs = pgTable(
  '_briven_auth_orgs',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    logo: text('logo'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    slugUniq: uniqueIndex('_briven_auth_orgs_slug_uniq').on(t.slug),
  }),
);

export const authOrgMembers = pgTable(
  '_briven_auth_org_members',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => authOrgs.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    pairUniq: uniqueIndex('_briven_auth_org_members_pair_uniq').on(t.orgId, t.userId),
    userIdx: index('_briven_auth_org_members_user_idx').on(t.userId),
  }),
);

export const authOrgInvites = pgTable(
  '_briven_auth_org_invites',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => authOrgs.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull().default('member'),
    token: text('token').notNull(),
    expiresAt: ts('expires_at').notNull(),
    invitedBy: text('invited_by').references(() => authUsers.id, { onDelete: 'set null' }),
    acceptedAt: ts('accepted_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    tokenUniq: uniqueIndex('_briven_auth_org_invites_token_uniq').on(t.token),
    orgIdx: index('_briven_auth_org_invites_org_idx').on(t.orgId),
  }),
);

/**
 * Two-factor authentication — TOTP secrets + backup codes.
 * Better Auth twoFactor plugin model (model name `twoFactor`).
 */
export const authTwoFactors = pgTable(
  '_briven_auth_two_factors',
  {
    id: id(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    verified: boolean('verified').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('_briven_auth_two_factors_user_idx').on(t.userId),
  }),
);

/**
 * WebAuthn passkeys — FIDO2 credentials.
 * Better Auth passkey plugin model (model name `passkey`).
 */
export const authPasskeys = pgTable(
  '_briven_auth_passkeys',
  {
    id: id(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('_briven_auth_passkeys_user_idx').on(t.userId),
  }),
);

export const authSchema = {
  user: authUsers,
  session: authSessions,
  account: authAccounts,
  verification: authVerificationTokens,
  // jwt-plugin key store (model name `jwks` is what the plugin looks up).
  jwks: authJwks,
  // briven-specific extra — Better Auth doesn't ship an audit-log model.
  auditLog: authAuditLog,
  // Organization tables (Phase 2 — not consumed by Better Auth directly).
  org: authOrgs,
  orgMember: authOrgMembers,
  orgInvite: authOrgInvites,
  // Phase 3 — MFA + Passkeys.
  twoFactor: authTwoFactors,
  passkey: authPasskeys,
} as const;

export type AuthUser = typeof authUsers.$inferSelect;
export type AuthSession = typeof authSessions.$inferSelect;
export type AuthAccount = typeof authAccounts.$inferSelect;
export type AuthVerificationToken = typeof authVerificationTokens.$inferSelect;
export type AuthJwk = typeof authJwks.$inferSelect;
export type AuthAuditLogEntry = typeof authAuditLog.$inferSelect;
export type AuthOrg = typeof authOrgs.$inferSelect;
export type AuthOrgMember = typeof authOrgMembers.$inferSelect;
export type AuthOrgInvite = typeof authOrgInvites.$inferSelect;
export type AuthTwoFactor = typeof authTwoFactors.$inferSelect;
export type AuthPasskey = typeof authPasskeys.$inferSelect;

/** Audit-action vocabulary. Open union — services can emit any string, but the
 *  listed values are guaranteed to be handled by the admin dashboard's filter
 *  UI without extra wiring. */
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

/** Verification-token type vocabulary (used by mailer/UI labels). */
export const AUTH_VERIFICATION_TYPES = [
  'magic_link',
  'otp',
  'password_reset',
  'email_verify',
] as const;
export type AuthVerificationType = (typeof AUTH_VERIFICATION_TYPES)[number];

/** OAuth provider ids known to briven auth. */
export const AUTH_OAUTH_PROVIDERS = [
  'google',
  'github',
  'discord',
  'microsoft',
  'apple',
  'twitter',
  'linkedin',
  'gitlab',
  'bitbucket',
  'dropbox',
  'facebook',
  'spotify',
] as const;
export type AuthOAuthProvider = (typeof AUTH_OAUTH_PROVIDERS)[number];
