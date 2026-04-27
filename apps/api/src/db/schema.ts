/**
 * Control-plane meta-DB schema.
 *
 * Per CLAUDE.md §8.1: every table has `id` (ULID PK), `created_at`,
 * `updated_at`, and `deleted_at` (soft-delete). The id column is `text` —
 * briven-managed rows store prefixed ULIDs (28 chars), Better Auth tables
 * store its 32-char nanoids, both fit cleanly without a length cap.
 *
 * Better Auth also reads / writes `users`, `accounts`, `sessions`, `verifications`
 * via its drizzle adapter; schema here matches Better Auth's expected shape so
 * the adapter works without translation.
 */
import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// Per CLAUDE.md §8.1 we use prefixed ULIDs (28 chars) for briven-managed
// rows, but Better Auth-managed tables use its own 32-char nanoid scheme.
// Keep the column flexible: `text` accommodates both without truncation.
const id = () => text('id').primaryKey();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').defaultNow().notNull();
const updatedAt = () => ts('updated_at').defaultNow().notNull();
const deletedAt = () => ts('deleted_at');

/* ─── users ──────────────────────────────────────────────────────── */
export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    name: text('name'),
    image: text('image'),
    // Platform super-admin. Step-up auth required for every admin action
    // (CLAUDE.md §5.4). Defaults false; j flips the bit directly in
    // postgres for the first admin.
    isAdmin: boolean('is_admin').default(false).notNull(),
    // Set by an admin to freeze all sign-in attempts + deploys. Sessions
    // are invalidated on next request.
    suspendedAt: ts('suspended_at'),
    /*
     * EU GDPR / AML billing profile. All fields optional at create time;
     * required before a paid subscription checkout (enforced at checkout).
     * Stored in the control plane, never in a customer schema. Address
     * block is the natural person or legal entity the invoice issues to.
     */
    legalName: text('legal_name'),
    companyName: text('company_name'),
    vatId: text('vat_id'),
    // Set when a vat_id is confirmed valid against VIES. Locks the field
    // against further self-service edits — changes after this must go
    // through support (legal/compliance: treat a verified VAT as a
    // point-in-time attestation we relied on for tax treatment).
    vatVerifiedAt: ts('vat_verified_at'),
    addressLine1: text('address_line_1'),
    addressLine2: text('address_line_2'),
    addressCity: text('address_city'),
    addressPostalCode: text('address_postal_code'),
    addressRegion: text('address_region'),
    // ISO 3166-1 alpha-2 (e.g. 'BE', 'NL'). Determines VAT treatment.
    addressCountry: text('address_country'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_idx').on(t.email),
  }),
);

/* ─── accounts (Better Auth: provider-linked credentials) ─────────── */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    userIdx: index('accounts_user_id_idx').on(t.userId),
    providerIdx: uniqueIndex('accounts_provider_account_idx').on(t.providerId, t.accountId),
  }),
);

/* ─── sessions ────────────────────────────────────────────────────── */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: ts('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    tokenIdx: uniqueIndex('sessions_token_idx').on(t.token),
    userIdx: index('sessions_user_id_idx').on(t.userId),
  }),
);

/* ─── verifications (magic link tokens, email verification) ───────── */
export const verifications = pgTable(
  'verifications',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    identifierIdx: index('verifications_identifier_idx').on(t.identifier),
  }),
);

/* ─── organizations ───────────────────────────────────────────────── */
export const orgRole = ['owner', 'admin', 'developer', 'viewer'] as const;
export type OrgRole = (typeof orgRole)[number];

export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    // True for the auto-created first org per user. Lets the UI keep a
    // single-org implicit UX until Phase 3 adds a switcher.
    personal: boolean('personal').notNull().default(false),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    slugIdx: uniqueIndex('organizations_slug_idx').on(t.slug),
  }),
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export const orgMembers = pgTable(
  'org_members',
  {
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Stored but not enforced this project — Phase 3 wires RBAC.
    role: text('role').$type<OrgRole>().notNull().default('developer'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.userId] }),
    userIdx: index('org_members_user_id_idx').on(t.userId),
  }),
);

/* ─── projects ────────────────────────────────────────────────────── */
export const projectTier = ['free', 'pro', 'team'] as const;
export type ProjectTier = (typeof projectTier)[number];

export const projects = pgTable(
  'projects',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    region: text('region').notNull().default('eu-west-1'),
    tier: text('tier').$type<ProjectTier>().notNull().default('free'),
    shardId: text('shard_id'),
    dataSchemaName: text('data_schema_name'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    slugIdx: uniqueIndex('projects_slug_idx').on(t.slug),
    orgIdx: index('projects_org_idx').on(t.orgId),
  }),
);

/* ─── project_members (Phase 3 RBAC — columns exist, roles stubbed) ─ */
export const memberRole = ['owner', 'admin', 'developer', 'viewer'] as const;
export type MemberRole = (typeof memberRole)[number];

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<MemberRole>().notNull().default('developer'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.userId] }),
  }),
);

/* ─── billing / subscriptions ─────────────────────────────────────── */
export const subscriptionStatus = ['trialing', 'active', 'past_due', 'canceled'] as const;
export type SubscriptionStatus = (typeof subscriptionStatus)[number];

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    polarSubscriptionId: text('polar_subscription_id'),
    polarCustomerId: text('polar_customer_id'),
    tier: text('tier').$type<ProjectTier>().notNull().default('free'),
    status: text('status').$type<SubscriptionStatus>().notNull().default('active'),
    currentPeriodEnd: ts('current_period_end'),
    canceledAt: ts('canceled_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    orgIdx: uniqueIndex('subscriptions_org_idx').on(t.orgId),
    polarIdx: index('subscriptions_polar_idx').on(t.polarSubscriptionId),
  }),
);

export type Subscription = typeof subscriptions.$inferSelect;

/* ─── project_invitations ────────────────────────────────────────── */
export const projectInvitations = pgTable(
  'project_invitations',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').$type<MemberRole>().notNull().default('developer'),
    // SHA-256 hash of the single-use accept token; plaintext only rides
    // in the invite email and the recipient's URL.
    tokenHash: text('token_hash').notNull(),
    invitedBy: text('invited_by').references(() => users.id),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => ({
    projectEmailIdx: uniqueIndex('project_invitations_project_email_idx').on(t.projectId, t.email),
    tokenIdx: uniqueIndex('project_invitations_token_idx').on(t.tokenHash),
  }),
);

export type ProjectInvitation = typeof projectInvitations.$inferSelect;

/* ─── project_env_vars ────────────────────────────────────────────── */
export const projectEnvVars = pgTable(
  'project_env_vars',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    // AES-256-GCM ciphertext of the value, base64. Never read directly —
    // always through services/project-env.ts which wraps decrypt.
    encryptedValue: text('encrypted_value').notNull(),
    createdBy: text('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    projectKeyIdx: uniqueIndex('project_env_vars_project_key_idx').on(t.projectId, t.key),
  }),
);

export type ProjectEnvVar = typeof projectEnvVars.$inferSelect;

/* ─── api_keys / deploy keys ──────────────────────────────────────── */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    // SHA-256 of the plaintext key — we never store the plaintext after creation.
    hash: text('hash').notNull(),
    // Last 4 chars of the plaintext — safe to show in the dashboard as a hint.
    suffix: varchar('suffix', { length: 4 }).notNull(),
    // Effective role this key carries when authenticating a request. Default
    // is 'admin' for backward compat with keys minted before per-key role
    // scoping landed; new keys can be issued with any of the standard roles
    // (viewer / developer / admin) — owner is never assignable to a key.
    role: text('role').$type<MemberRole>().notNull().default('admin'),
    lastUsedAt: ts('last_used_at'),
    expiresAt: ts('expires_at'),
    createdAt: createdAt(),
    revokedAt: ts('revoked_at'),
  },
  (t) => ({
    hashIdx: uniqueIndex('api_keys_hash_idx').on(t.hash),
    projectIdx: index('api_keys_project_idx').on(t.projectId),
  }),
);

/* ─── deployments ─────────────────────────────────────────────────── */
export const deploymentStatus = ['pending', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type DeploymentStatus = (typeof deploymentStatus)[number];

export const deployments = pgTable(
  'deployments',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    triggeredBy: text('triggered_by').references(() => users.id),
    apiKeyId: text('api_key_id').references(() => apiKeys.id),
    status: text('status').$type<DeploymentStatus>().notNull().default('pending'),
    schemaDiffSummary: jsonb('schema_diff_summary'),
    // Full schema definition as declared by the user at deploy time. Every
    // deployment is a self-contained snapshot so rollbacks and diffs don't
    // depend on reconstructing from a chain of migrations.
    schemaSnapshot: jsonb('schema_snapshot'),
    functionCount: varchar('function_count', { length: 12 }),
    functionNames: jsonb('function_names'),
    // Map of `<relative path under briven/functions/>` → TS source. Runtime
    // fetches this via the internal bundle endpoint and writes the files to
    // a temp dir before importing. Phase 1 stores raw source; Phase 2 moves
    // to a content-addressed tarball in MinIO once bundles exceed a few MB.
    bundle: jsonb('bundle'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    createdAt: createdAt(),
  },
  (t) => ({
    projectCreatedIdx: index('deployments_project_created_idx').on(t.projectId, t.createdAt),
    statusIdx: index('deployments_status_idx').on(t.status),
  }),
);

/* ─── function_logs ───────────────────────────────────────────────── */
/*
 * Durable copy of each invocation envelope that the runtime publishes to
 * Redis. The async log-fanout worker copies entries from `logs:{projectId}`
 * streams into this table; the dashboard queries it for the Logs page, and
 * a daily retention cron trims rows older than the tier-configured window.
 *
 * Per CLAUDE.md §5.1 user content fields (`user_logs_json`, `err_message`)
 * pass through unmodified — they are the user's own data about their own
 * project, surfaced only to the account owner.
 */
export const functionLogs = pgTable(
  'function_logs',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    deploymentId: text('deployment_id')
      .notNull()
      .references(() => deployments.id, { onDelete: 'cascade' }),
    invocationId: text('invocation_id').notNull(),
    functionName: varchar('function_name', { length: 128 }).notNull(),
    status: varchar('status', { length: 8 }).notNull(),
    durationMs: varchar('duration_ms', { length: 12 }).notNull(),
    touchedTables: jsonb('touched_tables').notNull(),
    userLogsJson: jsonb('user_logs_json').notNull(),
    errCode: text('err_code'),
    errMessage: text('err_message'),
    createdAt: createdAt(),
  },
  (t) => ({
    projectCreatedIdx: index('function_logs_project_created_idx').on(t.projectId, t.createdAt),
  }),
);

/* ─── audit_logs ──────────────────────────────────────────────────── */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorId: text('actor_id').references(() => users.id),
    projectId: text('project_id').references(() => projects.id),
    action: text('action').notNull(),
    // SHA-256 hash of the caller IP — we never store raw IPs (CLAUDE.md §5.1).
    ipHash: varchar('ip_hash', { length: 64 }),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata'),
    createdAt: createdAt(),
  },
  (t) => ({
    projectCreatedIdx: index('audit_logs_project_created_idx').on(t.projectId, t.createdAt),
    actorCreatedIdx: index('audit_logs_actor_created_idx').on(t.actorId, t.createdAt),
  }),
);

/* ─── type exports ────────────────────────────────────────────────── */
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type Deployment = typeof deployments.$inferSelect;
export type NewDeployment = typeof deployments.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type FunctionLog = typeof functionLogs.$inferSelect;
export type NewFunctionLog = typeof functionLogs.$inferInsert;
export type NewAuditLog = typeof auditLogs.$inferInsert;
