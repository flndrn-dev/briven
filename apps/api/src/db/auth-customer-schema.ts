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

/**
 * User security state — suspensions, bans, and moderation flags.
 * Auxiliary table (never ALTER the users table per DoltGres constraints).
 * One row per user; created on first moderation action.
 */
export const authUserSecurity = pgTable(
  '_briven_auth_user_security',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    /** When set, the user cannot sign in or use sessions. */
    suspendedAt: ts('suspended_at'),
    suspendedReason: text('suspended_reason'),
    /** When set, the user is permanently banned. Takes precedence over suspension. */
    bannedAt: ts('banned_at'),
    bannedReason: text('banned_reason'),
    /** Optional ban expiry; null = permanent. */
    banExpiresAt: ts('ban_expires_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('_briven_auth_user_security_user_idx').on(t.userId),
  }),
);

/**
 * Waitlist — users who requested access when signUpMode = 'waitlist'.
 * Admins approve/reject via dashboard; approved users receive an email
 * and can then complete sign-up.
 */
export const authWaitlist = pgTable(
  '_briven_auth_waitlist',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name'),
    /** pending | approved | rejected */
    status: text('status').notNull().default('pending'),
    approvedAt: ts('approved_at'),
    approvedBy: text('approved_by'),
    rejectedAt: ts('rejected_at'),
    rejectedReason: text('rejected_reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex('_briven_auth_waitlist_email_idx').on(t.email),
    statusIdx: index('_briven_auth_waitlist_status_idx').on(t.status),
  }),
);

/**
 * Session activity tracking — for inactivity timeout (Phase 2).
 * One row per active session. Updated on every authenticated request.
 * When inactivity timeout is disabled, this table is not written to.
 */
export const authSessionActivity = pgTable(
  '_briven_auth_session_activity',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => authSessions.id, { onDelete: 'cascade' }),
    lastActiveAt: ts('last_active_at').notNull().defaultNow(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    sessionIdx: uniqueIndex('_briven_auth_session_activity_session_idx').on(t.sessionId),
  }),
);



/**
 * Sign-in tokens — single-use JWTs for programmatic session creation.
 * Admin/backend creates a token; the client exchanges it for a session.
 * Once used, the token cannot be reused.
 */
export const authSigninTokens = pgTable(
  '_briven_auth_signin_tokens',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    tokenHashUniq: uniqueIndex('_briven_auth_signin_tokens_hash_uniq').on(t.tokenHash),
    userIdx: index('_briven_auth_signin_tokens_user_idx').on(t.userId),
    expiresIdx: index('_briven_auth_signin_tokens_expires_idx').on(t.expiresAt),
  }),
);

export type AuthSigninToken = typeof authSigninTokens.$inferSelect;

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
export type AuthUserSecurity = typeof authUserSecurity.$inferSelect;
export type AuthWaitlist = typeof authWaitlist.$inferSelect;
export type AuthSessionActivity = typeof authSessionActivity.$inferSelect;

/**
 * User metadata — public and private JSON blobs (Phase 3).
 * Public metadata is readable from frontend + backend.
 * Private metadata is backend-only.
 * One row per user; created lazily on first write.
 */
export const authUserMetadata = pgTable(
  '_briven_auth_user_metadata',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    publicMetadata: jsonb('public_metadata').notNull().default({}),
    privateMetadata: jsonb('private_metadata').notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    userIdx: uniqueIndex('_briven_auth_user_metadata_user_idx').on(t.userId),
  }),
);

/**
 * Additional email addresses per user (Phase 3).
 * Users can have multiple verified emails; one is primary.
 * The `email` column on `_briven_auth_users` remains the primary
 * sign-in identifier; this table stores extras.
 */
export const authUserEmails = pgTable(
  '_briven_auth_user_emails',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    verified: boolean('verified').notNull().default(false),
    primary: boolean('primary').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    userEmailUniq: uniqueIndex('_briven_auth_user_emails_user_email_uniq').on(t.userId, t.email),
  }),
);

export type AuthUserMetadata = typeof authUserMetadata.$inferSelect;
export type AuthUserEmail = typeof authUserEmails.$inferSelect;

/**
 * Phase 4 — Custom roles & permissions per organization.
 * Each org can define roles with a JSONB array of permission strings.
 * Default roles (owner, admin, member) are seeded on org creation.
 */
export const authOrgRoles = pgTable(
  '_briven_auth_org_roles',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => authOrgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    permissions: jsonb('permissions').notNull().default([]),
    /** System roles (owner/admin/member) cannot be deleted or renamed. */
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    orgNameUniq: uniqueIndex('_briven_auth_org_roles_org_name_uniq').on(t.orgId, t.name),
  }),
);

export type AuthOrgRole = typeof authOrgRoles.$inferSelect;

/**
 * Phase 4 — Verified domains for organizations.
 * Admins add a domain, receive a DNS TXT challenge, and verify ownership.
 * When `auto_join_enabled` is true, users whose email domain matches are
 * automatically added as members on their first sign-in.
 */
export const authOrgDomains = pgTable(
  '_briven_auth_org_domains',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => authOrgs.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
    verificationToken: text('verification_token').notNull(),
    verifiedAt: ts('verified_at'),
    autoJoinEnabled: boolean('auto_join_enabled').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    orgDomainUniq: uniqueIndex('_briven_auth_org_domains_org_domain_uniq').on(t.orgId, t.domain),
  }),
);

export type AuthOrgDomain = typeof authOrgDomains.$inferSelect;

/**
 * Phase 4 — Membership requests (request-to-join flow).
 * Users request to join an org; admins approve or reject.
 */
export const authOrgMembershipRequests = pgTable(
  '_briven_auth_org_membership_requests',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => authOrgs.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    /** pending | approved | rejected */
    status: text('status').notNull().default('pending'),
    message: text('message'),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    resolvedAt: ts('resolved_at'),
    resolvedBy: text('resolved_by').references(() => authUsers.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    orgUserUniq: uniqueIndex('_briven_auth_org_membership_requests_org_user_uniq').on(t.orgId, t.userId),
    orgStatusIdx: index('_briven_auth_org_membership_requests_org_status_idx').on(t.orgId, t.status),
  }),
);

export type AuthOrgMembershipRequest = typeof authOrgMembershipRequests.$inferSelect;

/**
 * Phase 4 — Active organization per session.
 * Tracks which org the user has selected as "active" for each session.
 * This enables org switching without re-authentication.
 * Never ALTER the sessions table — auxiliary table per DoltGres rules.
 */
export const authSessionOrgs = pgTable(
  '_briven_auth_session_orgs',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => authSessions.id, { onDelete: 'cascade' }),
    orgId: text('org_id')
      .notNull()
      .references(() => authOrgs.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    sessionUniq: uniqueIndex('_briven_auth_session_orgs_session_uniq').on(t.sessionId),
  }),
);

export type AuthSessionOrg = typeof authSessionOrgs.$inferSelect;

/**
 * Phase 5 — Enterprise SSO connections (SAML 2.0 + OIDC).
 * Each connection represents a single enterprise IdP relationship.
 * `config` is a JSONB blob that holds provider-specific settings:
 *   - SAML: idpMetadataXml, idpSsoUrl, idpCert, spEntityId, etc.
 *   - OIDC: issuer, clientId, authorizationUrl, tokenUrl, userinfoUrl, etc.
 * `domains` restricts which email domains may use this connection.
 * `jitEnabled` controls whether unknown users are auto-created on first SSO.
 */
export const authSsoConnections = pgTable(
  '_briven_auth_sso_connections',
  {
    id: id(),
    name: text('name').notNull(),
    providerType: text('provider_type').notNull(), // 'saml' | 'oidc'
    config: jsonb('config').notNull().default({}),
    domains: jsonb('domains').notNull().default([]),
    jitEnabled: boolean('jit_enabled').notNull().default(true),
    deactivatedAt: ts('deactivated_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    nameIdx: index('_briven_auth_sso_connections_name_idx').on(t.name),
  }),
);

export type AuthSsoConnection = typeof authSsoConnections.$inferSelect;

/**
 * Phase 5 — SSO session tracking.
 * Links a Better Auth session to the SSO connection that created it.
 * Enables automatic deprovisioning (revoke all sessions for a connection).
 * One row per session created via enterprise SSO.
 */
export const authSsoSessions = pgTable(
  '_briven_auth_sso_sessions',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => authSessions.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id')
      .notNull()
      .references(() => authSsoConnections.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    sessionUniq: uniqueIndex('_briven_auth_sso_sessions_session_uniq').on(t.sessionId),
    connIdx: index('_briven_auth_sso_sessions_conn_idx').on(t.connectionId),
  }),
);

export type AuthSsoSession = typeof authSsoSessions.$inferSelect;

/**
 * Phase 6.2 — Impersonation session tracking.
 * Links a session to the admin who created it for support purposes.
 * Enables audit trails and "stop impersonating" flows.
 */
export const authImpersonationSessions = pgTable(
  '_briven_auth_impersonation_sessions',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => authSessions.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonated_by').notNull(),
    targetUserId: text('target_user_id').notNull(),
    stoppedAt: ts('stopped_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    sessionUniq: uniqueIndex('_briven_auth_impersonation_sessions_session_uniq').on(t.sessionId),
  }),
);

export type AuthImpersonationSession = typeof authImpersonationSessions.$inferSelect;

/**
 * Phase 6.3 — Application logs.
 * Structured operational logs for the auth tenant (errors, warnings, info).
 * Retention is controlled by the tenant's retention config.
 */
export const authAppLogs = pgTable(
  '_briven_auth_app_logs',
  {
    id: id(),
    level: text('level').notNull(), // 'error' | 'warn' | 'info'
    action: text('action').notNull(),
    message: text('message').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => ({
    levelCreatedIdx: index('_briven_auth_app_logs_level_created_idx').on(t.level, t.createdAt),
    actionCreatedIdx: index('_briven_auth_app_logs_action_created_idx').on(t.action, t.createdAt),
  }),
);

export type AuthAppLog = typeof authAppLogs.$inferSelect;

/**
 * Phase 6.6 — Compliance metadata.
 * Tracks SOC 2, HIPAA BAA, and GDPR DPA status per tenant.
 */
export const authCompliance = pgTable(
  '_briven_auth_compliance',
  {
    id: id(),
    soc2ControlsUrl: text('soc2_controls_url'),
    hipaaBaaSignedAt: ts('hipaa_baa_signed_at'),
    hipaaBaaSignedBy: text('hipaa_baa_signed_by'),
    gdprDpaSignedAt: ts('gdpr_dpa_signed_at'),
    gdprDpaSignedBy: text('gdpr_dpa_signed_by'),
    encryptionAtRestEnabled: boolean('encryption_at_rest_enabled').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
);

export type AuthCompliance = typeof authCompliance.$inferSelect;

/**
 * Phase 7.1 — JWT Templates.
 * Named claim sets that tenants can define and reference when requesting
 * a signed JWT. Claims are merged with the default token payload.
 */
export const authJwtTemplates = pgTable(
  '_briven_auth_jwt_templates',
  {
    id: id(),
    name: text('name').notNull(),
    claims: jsonb('claims').notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    nameUniq: uniqueIndex('_briven_auth_jwt_templates_name_uniq').on(t.name),
  }),
);

export type AuthJwtTemplate = typeof authJwtTemplates.$inferSelect;

/**
 * Phase 7.3 — User usernames.
 * Auxiliary table for username-based authentication. Each user can have
 * at most one username. Uniqueness is per tenant.
 */
export const authUserUsernames = pgTable(
  '_briven_auth_user_usernames',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    username: text('username').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    usernameUniq: uniqueIndex('_briven_auth_user_usernames_username_uniq').on(t.username),
    userIdx: uniqueIndex('_briven_auth_user_usernames_user_idx').on(t.userId),
  }),
);

export type AuthUserUsername = typeof authUserUsernames.$inferSelect;

/**
 * Phase 7.4 — Testing tokens.
 * Special tokens for E2E test suites that bypass bot protection,
 * rate limiting, and MFA requirements. Created via admin API;
 * exchanged for a real session via customer API.
 */
export const authTestTokens = pgTable(
  '_briven_auth_test_tokens',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    name: text('name'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    tokenHashUniq: uniqueIndex('_briven_auth_test_tokens_hash_uniq').on(t.tokenHash),
    userIdx: index('_briven_auth_test_tokens_user_idx').on(t.userId),
  }),
);

export type AuthTestToken = typeof authTestTokens.$inferSelect;

/**
 * Phase 7.5 — Email templates.
 * Per-tenant overrides for transactional emails.
 * When active, the custom template replaces the default briven template.
 */
export const authEmailTemplates = pgTable(
  '_briven_auth_email_templates',
  {
    id: id(),
    name: text('name').notNull(), // 'verification' | 'magic-link' | 'otp' | 'password-reset'
    subject: text('subject').notNull(),
    html: text('html').notNull(),
    text: text('text'),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    nameUniq: uniqueIndex('_briven_auth_email_templates_name_uniq').on(t.name),
  }),
);

export type AuthEmailTemplate = typeof authEmailTemplates.$inferSelect;

/**
 * OIDC state store — short-lived nonce/state pairs for the OIDC enterprise
 * authorization-code flow.  States expire after 10 minutes and are deleted
 * after a single use.
 */
export const authOidcStates = pgTable(
  '_briven_auth_oidc_states',
  {
    id: id(),
    state: text('state').notNull(),
    nonce: text('nonce').notNull(),
    connectionId: text('connection_id').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => ({
    stateUniq: uniqueIndex('_briven_auth_oidc_states_state_uniq').on(t.state),
  }),
);

export type AuthOidcState = typeof authOidcStates.$inferSelect;

/**
 * Device tracking — fingerprint-based new-device detection (Gap Fix #6).
 * Stores a hashed fingerprint per user + device. No raw IPs (privacy).
 */
export const authDevices = pgTable(
  '_briven_auth_devices',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    userFingerprintUniq: uniqueIndex('_briven_auth_devices_user_fingerprint_uniq').on(t.userId, t.fingerprint),
    userIdx: index('_briven_auth_devices_user_idx').on(t.userId),
  }),
);

export type AuthDevice = typeof authDevices.$inferSelect;

/**
 * Phase 7.1 — Custom JWT signing keys.
 * Separate from Better Auth's jwks table so we control the key lifecycle
 * independently. Private key is a JWK string (JSON); encryption at rest
 * is handled by DoltGres / the storage layer.
 */
export const authCustomJwks = pgTable('_briven_auth_custom_jwks', {
  id: id(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at'),
});

export type AuthCustomJwk = typeof authCustomJwks.$inferSelect;

/**
 * Phase 8.4 — Password policy per tenant.
 * One row per project; enforced on sign-up and password change.
 */
export const authPasswordPolicy = pgTable('_briven_auth_password_policy', {
  id: id(),
  minLength: bigint('min_length', { mode: 'number' }).notNull().default(8),
  requireUppercase: boolean('require_uppercase').notNull().default(false),
  requireLowercase: boolean('require_lowercase').notNull().default(false),
  requireNumber: boolean('require_number').notNull().default(false),
  requireSpecial: boolean('require_special').notNull().default(false),
  maxAgeDays: bigint('max_age_days', { mode: 'number' }),
  preventReuse: bigint('prevent_reuse', { mode: 'number' }).notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export type AuthPasswordPolicy = typeof authPasswordPolicy.$inferSelect;

/**
 * Phase 8.4 — Password history per user (for reuse prevention).
 */
export const authPasswordHistory = pgTable(
  '_briven_auth_password_history',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    passwordHash: text('password_hash').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('_briven_auth_password_history_user_idx').on(t.userId),
  }),
);

export type AuthPasswordHistory = typeof authPasswordHistory.$inferSelect;

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
  // Phase 1 — Security Foundation.
  userSecurity: authUserSecurity,
  waitlist: authWaitlist,
  // Phase 2 — Session activity tracking.
  sessionActivity: authSessionActivity,
  // Gap Fix #6 — Device tracking.
  device: authDevices,
  // Phase 3 — User metadata.
  userMetadata: authUserMetadata,
  // Phase 3 — Multiple emails per user.
  userEmail: authUserEmails,
  // Phase 3 — Sign-in tokens.
  signinToken: authSigninTokens,
  // Phase 4 — Organizations & B2B.
  orgRole: authOrgRoles,
  orgDomain: authOrgDomains,
  orgMembershipRequest: authOrgMembershipRequests,
  sessionOrg: authSessionOrgs,
  // Phase 5 — Enterprise SSO.
  ssoConnection: authSsoConnections,
  ssoSession: authSsoSessions,
  // Phase 6.2 — Impersonation tracking.
  impersonationSession: authImpersonationSessions,
  // Phase 6.3 — Application logs.
  appLog: authAppLogs,
  // Phase 6.6 — Compliance metadata.
  compliance: authCompliance,
  // Phase 7.1 — JWT Templates.
  jwtTemplate: authJwtTemplates,
  customJwks: authCustomJwks,
  // Phase 7.3 — User usernames.
  userUsername: authUserUsernames,
  // Phase 7.4 — Testing tokens.
  testToken: authTestTokens,
  // Phase 7.5 — Email templates.
  emailTemplate: authEmailTemplates,
  // OIDC state store (Gap Fix #3).
  oidcState: authOidcStates,
  // Gap Fix #13 — Password policy.
  passwordPolicy: authPasswordPolicy,
  passwordHistory: authPasswordHistory,
} as const;

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
