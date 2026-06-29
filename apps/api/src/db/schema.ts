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
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
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
    // Most recent step-up attestation timestamp. The `requireRecentMfa`
    // middleware accepts requests when this is within the configured
    // window (default 10 min per CLAUDE.md §5.4). Bumped by
    // POST /v1/auth/step-up after a successful password re-prompt.
    lastMfaAt: ts('last_mfa_at'),
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
    // EU business registration number (e.g. French SIREN, German HRB,
    // Belgian KBO/BCE). Separate from VAT ID — many micro-businesses
    // have a registration number but no VAT ID.
    companyRegistrationNumber: text('company_registration_number'),
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
    // KYC — required before paid checkout under EU AML. The underlying
    // column is DATE; drizzle `date` (default mode 'string') returns the
    // ISO yyyy-mm-dd as a string, matching the existing storage without a
    // destructive ALTER (was declared `text` here, which drifted from the
    // DB and would make db:generate emit a column-type ALTER — audit Theme).
    dateOfBirth: date('date_of_birth'),
    // ISO 3166-1 alpha-2 (e.g. 'BE'). Separate from address_country —
    // residency drives VAT, birth drives KYC.
    countryOfBirth: text('country_of_birth'),
    // IANA zone name (e.g. 'Europe/Brussels'). Used to render timestamps
    // and schedule the Pro digest at the user's local 09:00 instead of
    // a flat UTC time.
    timezone: text('timezone'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    // Optional free-text reason the user supplied at deletion time.
    // Surfaced only in audit_logs / admin tools — never replayed back
    // to the user, never used in cross-user analytics.
    deletionReason: text('deletion_reason'),
    // User-chosen "delete secret" gating project deletion. Mirrors the SDK
    // key pattern (migration 0034/0039): sha-256 hex `delete_secret_hash`
    // is the sole verification mechanism, while AES-256-GCM
    // `delete_secret_enc` (BRIVEN_ENCRYPTION_KEY KEK via
    // services/project-env.ts) lets the owner reveal/copy the secret again
    // through the authenticated + audited reveal path. All NULLABLE — a
    // user without a secret set has all three null.
    deleteSecretHash: text('delete_secret_hash'),
    deleteSecretEnc: text('delete_secret_enc'),
    deleteSecretSetAt: ts('delete_secret_set_at'),
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
    // Nullable + ON DELETE SET NULL so a GDPR hard-delete of the creating
    // user can proceed when this org is shared (multi-owner) and survives
    // the purge — the creator reference simply nulls out instead of an FK
    // violation blocking the whole DELETE. Sole-owner orgs are hard-deleted
    // before the user in the same purge transaction, so they never rely on
    // this null-out.
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
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
    // Set by an admin (manually or via abuse-report auto-suspension) to
    // freeze every state-changing route on the project. Invokes return
    // 403 with code=project_suspended; reads stay open so the operator
    // can investigate via the dashboard. Setting to null re-enables.
    suspendedAt: ts('suspended_at'),
    suspendReason: text('suspend_reason'),
    // Sprint 4 storage admin: per-project overrides of the tier storage caps.
    // NULL = inherit the tier default from tier_storage_caps. Bytes are
    // unmeasurable on DoltGres, so limits are expressed as rows + tables.
    storageMaxRows: bigint('storage_max_rows', { mode: 'number' }),
    storageMaxTables: bigint('storage_max_tables', { mode: 'number' }),
    // Sprint 4 Phase 4 enforcement lever. 'flag' (default) only surfaces an
    // over-limit project in the admin dashboard and NEVER blocks a customer.
    // 'block' rejects new writes (createTable / insertRow) while the project
    // is over its effective cap. An admin opts a specific project into 'block'.
    storageEnforcement: text('storage_enforcement').$type<'flag' | 'block'>().notNull().default('flag'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    slugIdx: uniqueIndex('projects_slug_idx').on(t.slug),
    orgIdx: index('projects_org_idx').on(t.orgId),
    // Partial index over the suspended subset so the admin suspension scan
    // stays cheap. Declared here to match the index already present in the
    // live DB (audit: schema was missing this declaration).
    suspendedAtIdx: index('projects_suspended_at_idx')
      .on(t.suspendedAt)
      .where(sql`suspended_at IS NOT NULL`),
  }),
);

/* ─── tier_storage_caps (Sprint 4) — DB-backed, admin-editable storage caps ─
 * The Free/Pro/Team storage limits live here (not in code) so an admin can
 * change them from the dashboard without a redeploy. Bytes are unmeasurable on
 * DoltGres, so caps are rows + tables. Seeded by migration 0033.
 */
export const tierStorageCaps = pgTable('tier_storage_caps', {
  tier: text('tier').$type<ProjectTier>().primaryKey(),
  maxRows: bigint('max_rows', { mode: 'number' }).notNull(),
  maxTables: bigint('max_tables', { mode: 'number' }).notNull(),
  updatedAt: updatedAt(),
  updatedBy: text('updated_by'),
});

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
    // Reverse lookup "all projects a user belongs to" (membership scans in
    // access checks + the account-deletion sole-owner sweep). The composite
    // PK is (project_id, user_id) so user_id alone is not index-covered.
    userIdx: index('project_members_user_id_idx').on(t.userId),
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
    invitedBy: text('invited_by').references(() => users.id, { onDelete: 'set null' }),
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

/* ─── org_invitations ─────────────────────────────────────────────── */
/**
 * Pending invites to a team org. Mirrors project_invitations but
 * scoped to an org id + carries an OrgRole instead of MemberRole.
 * Acceptance creates the org_members row and marks accepted_at.
 */
export const orgInvitations = pgTable(
  'org_invitations',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').$type<OrgRole>().notNull().default('developer'),
    // SHA-256 hash of the single-use accept token; plaintext only rides
    // in the invite email and the recipient's URL.
    tokenHash: text('token_hash').notNull(),
    invitedBy: text('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => ({
    orgEmailIdx: uniqueIndex('org_invitations_org_email_idx').on(t.orgId, t.email),
    tokenIdx: uniqueIndex('org_invitations_token_idx').on(t.tokenHash),
  }),
);

export type OrgInvitation = typeof orgInvitations.$inferSelect;
export type NewOrgInvitation = typeof orgInvitations.$inferInsert;

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
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
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
    // Nullable + ON DELETE SET NULL so a GDPR hard-delete of the creating
    // user doesn't 23503-block on this key (the key stays scoped to its
    // project; only the creator attribution is severed). Was NOT NULL +
    // NO ACTION — a blocker of the account purge (audit Theme 0).
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
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
    triggeredBy: text('triggered_by').references(() => users.id, { onDelete: 'set null' }),
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
    // ON DELETE SET NULL so a GDPR hard-delete of the actor preserves the
    // audit row (action + timestamp survive) while severing the FK — keeps
    // the immutable audit trail intact without blocking the purge DELETE.
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    // ON DELETE SET NULL so a project hard-delete during a GDPR purge
    // doesn't 23503-block on retained audit rows (sibling of actor_id).
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
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

/* ─── email_suppressions ──────────────────────────────────────────── */
// Recipients we won't send to. Populated from mittera webhook events
// (email.bounced+permanent, email.complained, email.suppressed) and
// optionally by operator action. The outbound send path (lib/email.ts)
// short-circuits when the recipient is found here.
export const suppressionReason = [
  'permanent_bounce',
  'complaint',
  'mittera_suppressed',
  'manual',
] as const;

export const emailSuppressions = pgTable(
  'email_suppressions',
  {
    id: id(),
    // Stored lower-case so the lookup is case-insensitive without
    // requiring an expression index.
    email: text('email').notNull().unique(),
    reason: text('reason', { enum: suppressionReason }).notNull(),
    // Free-form context from the webhook event (bounce.message,
    // complaint reason text, suppression source). Never includes PII
    // beyond the email itself.
    detail: text('detail'),
    // The mittera event id that produced this row (idempotency).
    sourceEventId: text('source_event_id'),
    createdAt: createdAt(),
  },
  (t) => ({
    emailIdx: index('email_suppressions_email_idx').on(t.email),
    createdIdx: index('email_suppressions_created_idx').on(t.createdAt),
  }),
);

/* ─── usage events ───────────────────────────────────────────────── */
/**
 * Hourly usage rollups, one row per (project, hour, metric). Populated
 * by the apps/api usage-aggregation cron — reads function_logs +
 * pg_total_relation_size + the realtime /metrics endpoint and writes
 * one row per metric. Survives function_logs retention windows so
 * historical usage queries beyond 7 days (free tier) still resolve.
 *
 * Polar metering push reads from here. The push side is a separate
 * worker so a Polar outage doesn't block the aggregation cron.
 */
export const usageMetric = [
  'invocations',
  'storage_bytes',
  'connection_seconds',
  // briven auth MAU — distinct end-users active in the trailing 30 days.
  // Gauge sample (not a delta) snapshotted by the hourly aggregator and
  // pushed to Polar's `briven_auth_mau` meter for overage billing.
  'auth_mau',
] as const;
export type UsageMetric = (typeof usageMetric)[number];

export const usageEvents = pgTable(
  'usage_events',
  {
    id: id(),
    projectId: text('project_id').notNull(),
    metric: text('metric', { enum: usageMetric }).notNull(),
    // First millisecond of the UTC hour this row covers.
    periodStart: ts('period_start').notNull(),
    // For counters (invocations, connection_seconds): the delta in this
    // window. For gauges (storage_bytes): the sample value at period_end.
    value: text('value').notNull(),
    // 'pushed' once the Polar meter accepts it. Until then, 'pending'.
    // The push worker scans for pending rows and batches them.
    polarPushStatus: text('polar_push_status', {
      enum: ['pending', 'pushed', 'skipped'],
    })
      .notNull()
      .default('pending'),
    polarPushedAt: ts('polar_pushed_at'),
    createdAt: createdAt(),
  },
  (t) => ({
    projectPeriodIdx: uniqueIndex('usage_events_project_period_metric_idx').on(
      t.projectId,
      t.periodStart,
      t.metric,
    ),
    pendingIdx: index('usage_events_pending_idx')
      .on(t.polarPushStatus, t.periodStart)
      .where(sql`polar_push_status = 'pending'`),
  }),
);

/* ─── deploy history ─────────────────────────────────────────────── */
/**
 * One row per api boot — the audit trail behind /info.buildSha. Drives
 * the admin "Deploys" widget (last N rollouts: which sha, when, which
 * env) so operators can correlate "the bug appeared at 14:32" with
 * "deploy abc1234 went live at 14:30".
 *
 * Written from src/index.ts after migrations succeed; failure to insert
 * is logged but not fatal (the api still boots — observability is not
 * load-bearing for the request path).
 */
export const deployHistory = pgTable(
  'deploy_history',
  {
    id: id(),
    service: text('service').notNull(),
    buildSha: text('build_sha').notNull(),
    buildAt: text('build_at'),
    env: text('env').notNull(),
    // Explicit "booted_at" column name — semantically clearer than the
    // generic createdAt() helper for a row that records the moment of
    // process boot. (Also: the helper maps to "created_at" which would
    // mismatch the SQL migration.)
    bootedAt: ts('booted_at').defaultNow().notNull(),
  },
  (t) => ({
    serviceBootedIdx: index('deploy_history_service_booted_idx').on(t.service, t.bootedAt),
    buildShaIdx: index('deploy_history_build_sha_idx').on(t.buildSha),
  }),
);

/* ─── project_schedules (cron-triggered function invocations) ─────── */
export const scheduleRunStatus = ['pending', 'ok', 'error', 'skipped'] as const;
export type ScheduleRunStatus = (typeof scheduleRunStatus)[number];

export const projectSchedules = pgTable(
  'project_schedules',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    functionName: text('function_name').notNull(),
    // 5-field UTC cron expression (minute hour day month dow). The
    // service validates on write so we don't store anything the
    // dispatcher can't parse.
    cronExpression: text('cron_expression').notNull(),
    args: jsonb('args').$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    // Dispatcher claims rows by checking next_run_at <= now() and
    // bumping it forward in the same transaction. Indexing the partial
    // (enabled = true) subset keeps the claim query cheap as the table
    // grows.
    nextRunAt: ts('next_run_at').notNull(),
    lastRunAt: ts('last_run_at'),
    lastRunStatus: text('last_run_status').$type<ScheduleRunStatus>(),
    lastRunError: text('last_run_error'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    projectNameIdx: uniqueIndex('project_schedules_project_name_idx')
      .on(t.projectId, t.name)
      .where(sql`deleted_at is null`),
    dueIdx: index('project_schedules_due_idx')
      .on(t.nextRunAt)
      .where(sql`enabled = true and deleted_at is null`),
  }),
);

/* ─── webhook_endpoints (customer-defined inbound webhooks) ───────── */
export const webhookDeliveryStatus = ['ok', 'rejected_signature', 'rejected_replay', 'invoke_error', 'disabled'] as const;
export type WebhookDeliveryStatus = (typeof webhookDeliveryStatus)[number];

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // The function this endpoint dispatches to. Validated on write
    // against the project's deployed function list; can be edited later
    // without breaking — invocations to a missing function record an
    // `invoke_error` delivery and return 502 to the source.
    functionName: text('function_name').notNull(),
    // AES-256-GCM ciphertext (same KEK + format as project-env). The
    // plaintext is HMAC-SHA256'd over `${timestamp}.${rawBody}` to verify
    // X-Briven-Signature on every inbound request. Rotated by minting a
    // fresh secret + setting it here in a single UPDATE.
    signingSecretEncrypted: text('signing_secret_encrypted').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    lastDeliveryAt: ts('last_delivery_at'),
    lastDeliveryStatus: text('last_delivery_status').$type<WebhookDeliveryStatus>(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    projectNameIdx: uniqueIndex('webhook_endpoints_project_name_idx')
      .on(t.projectId, t.name)
      .where(sql`deleted_at is null`),
    projectIdx: index('webhook_endpoints_project_idx')
      .on(t.projectId)
      .where(sql`deleted_at is null`),
  }),
);

/* ─── webhook_deliveries (per-request audit log) ──────────────────── */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    // Denormalised — saves a join when the dashboard's per-project
    // "recent deliveries" view loads, and lets the per-project retention
    // cron prune rows without walking the endpoints table.
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: text('status').$type<WebhookDeliveryStatus>().notNull(),
    // HMAC-SHA256 of the source IP with the audit pepper, same scheme as
    // audit_logs.ip_hash. Per CLAUDE.md §5.1 we never store raw IPs.
    sourceIpHash: text('source_ip_hash'),
    // The function the dispatcher tried to call (snapshot from the
    // endpoint at delivery time — useful when the endpoint config has
    // since changed).
    functionName: text('function_name'),
    // Inner invoke duration in ms (excludes signature verification time).
    // Null for deliveries that never reached the runtime (signature reject).
    durationMs: text('duration_ms'),
    errorMessage: text('error_message'),
    createdAt: createdAt(),
  },
  (t) => ({
    endpointIdx: index('webhook_deliveries_endpoint_idx').on(t.endpointId, t.createdAt),
    projectIdx: index('webhook_deliveries_project_idx').on(t.projectId, t.createdAt),
  }),
);

/* ─── abuse_reports (dedicated table; replaces audit-log overload) ── */
export const abuseSeverity = ['spam', 'phishing', 'malware', 'csam', 'tos', 'other'] as const;
export type AbuseSeverity = (typeof abuseSeverity)[number];

export const abuseStatus = ['open', 'triaged', 'resolved'] as const;
export type AbuseStatusValue = (typeof abuseStatus)[number];

export const abuseResolution = ['no_action', 'warned', 'suspended', 'banned'] as const;
export type AbuseResolutionValue = (typeof abuseResolution)[number];

export const abuseReports = pgTable(
  'abuse_reports',
  {
    id: id(),
    targetUrl: text('target_url').notNull(),
    reason: text('reason').notNull(),
    severity: text('severity').$type<AbuseSeverity>().notNull(),
    reporterContact: text('reporter_contact'),
    // ip_hash + user_agent of the submission. Per CLAUDE.md §5.1 we
    // never store raw IPs even in the abuse pipeline.
    sourceIpHash: text('source_ip_hash'),
    sourceUserAgent: text('source_user_agent'),
    status: text('status').$type<AbuseStatusValue>().notNull().default('open'),
    resolution: text('resolution').$type<AbuseResolutionValue>(),
    // Populated by the resolver when the report maps to a real project.
    // FK is `set null` rather than `cascade` — if the project gets hard
    // deleted later we keep the report's history intact for audit.
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    triagedAt: ts('triaged_at'),
    triagedBy: text('triaged_by').references(() => users.id, { onDelete: 'set null' }),
    triageNotes: text('triage_notes'),
    resolvedAt: ts('resolved_at'),
    resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolveNotes: text('resolve_notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    statusIdx: index('abuse_reports_status_idx').on(t.status, t.createdAt),
    severityIdx: index('abuse_reports_severity_idx').on(t.severity, t.createdAt),
    projectIdx: index('abuse_reports_project_idx').on(t.projectId).where(sql`project_id is not null`),
  }),
);

/* ─── incidents (operator-published status events) ─────────────────── */
// Hand-curated platform-incident log. An admin opens an incident when
// something customer-impacting starts, edits the narrative as the
// situation unfolds, and resolves it when restored. The public status
// page and RSS feed read from this table.

export const incidentSeverity = ['critical', 'major', 'minor', 'maintenance'] as const;
export type IncidentSeverity = (typeof incidentSeverity)[number];

export const incidents = pgTable(
  'incidents',
  {
    id: id(),
    startedAt: ts('started_at').notNull(),
    resolvedAt: ts('resolved_at'),
    severity: text('severity').$type<IncidentSeverity>().notNull(),
    // List of affected services: 'api' | 'realtime' | 'runtime' | 'web'
    // | 'docs' | 'all'. Stored as jsonb so we can grow the vocabulary
    // without a migration.
    services: jsonb('services').$type<readonly string[]>().notNull(),
    summary: text('summary').notNull(),
    postmortem: text('postmortem').notNull().default(''),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    startedIdx: index('incidents_started_idx').on(t.startedAt),
    activeIdx: index('incidents_active_idx').on(t.startedAt).where(sql`resolved_at is null`),
  }),
);

/* ─── migration_requests (customer-initiated platform import intake) ── */
// One row per dashboard-wizard submission. The wizard at
// /dashboard/projects/new/migrate collects source platform + scale +
// credentials/notes; this row is then triaged by an operator via
// /dashboard/admin/migrations and either auto-migrated (once the
// adapter for the source ships) or hand-migrated for free during beta.
export const migrationSources = [
  'convex',
  'supabase',
  'firebase',
  'mongodb',
  'drizzle',
  'prisma',
  'postgres',
  'hasura',
  'nextauth',
  'other',
] as const;
export type MigrationSource = (typeof migrationSources)[number];

export const migrationUrgencies = [
  'direct',
  'this_week',
  'this_month',
  'this_quarter',
  'exploring',
] as const;
export type MigrationUrgency = (typeof migrationUrgencies)[number];

export const migrationStatuses = [
  'new',
  'contacted',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export type MigrationStatus = (typeof migrationStatuses)[number];

export const migrationRequests = pgTable(
  'migration_requests',
  {
    id: id(),
    // Nullable to support unauthenticated leads submitted via the
    // /migrate marketing form. When the operator promotes a lead (or
    // the customer signs up later), the operator patches user_id from
    // the admin triage row.
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    orgId: text('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    source: text('source').$type<MigrationSource>().notNull(),
    sourceUrl: text('source_url'),
    sourceNotes: text('source_notes').notNull().default(''),
    estimatedTables: integer('estimated_tables'),
    // bigint serialized as string in the wire format; jsonb-style number
    // is unsafe for >2^53. We accept up to ~10^15 rows (no real customer
    // hits that, but the column shouldn't artificially cap it).
    estimatedRows: bigint('estimated_rows', { mode: 'bigint' }),
    estimatedFunctions: integer('estimated_functions'),
    urgency: text('urgency').$type<MigrationUrgency>().notNull().default('exploring'),
    status: text('status').$type<MigrationStatus>().notNull().default('new'),
    contactEmail: text('contact_email').notNull(),
    assignedTo: text('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    operatorNotes: text('operator_notes').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    createdIdx: index('migration_requests_created_idx').on(t.createdAt),
    userIdx: index('migration_requests_user_idx').on(t.userId, t.createdAt),
    openIdx: index('migration_requests_open_idx')
      .on(t.createdAt)
      .where(sql`status not in ('completed', 'cancelled')`),
  }),
);

/* ─── contact_messages (public /contact form intake) ─────────────── */
// Public, unauthenticated contact-form submissions from the /contact
// marketing page. The sender's email is collected + stored here so the
// operator can reply privately — it is never rendered back to the
// website. Triaged out-of-band; `handled_at` is stamped once an operator
// has actioned the message.

export const contactTopics = [
  'general',
  'support',
  'sales',
  'self-host',
  'security',
  'privacy',
  'legal',
  'other',
] as const;
export type ContactTopic = (typeof contactTopics)[number];

// Support-ticket lifecycle. A contact submission becomes a ticket only
// when the sender tagged it with a routing tag (#support/#billing/etc).
// A fresh ticket starts at `no_response`; an operator can move it through
// the rest. Non-ticketed contact rows leave ticket_number/topic_code NULL
// and carry the default status (never surfaced for them).
export const ticketStatuses = ['no_response', 'in_review', 'replied', 'closed'] as const;
export type TicketStatus = (typeof ticketStatuses)[number];

// Per-topic 3-letter code stamped on a ticket. Derived from the primary
// routing tag (support→SUP, billing→BIL, technical→TEC, self-hosting→SLF).
export const ticketTopicCodes = ['SUP', 'BIL', 'TEC', 'SLF'] as const;
export type TicketTopicCode = (typeof ticketTopicCodes)[number];

// Who authored a thread message: the operator (admin reply) or the user.
export const ticketReplyAuthors = ['operator', 'user'] as const;
export type TicketReplyAuthor = (typeof ticketReplyAuthors)[number];

export const contactMessages = pgTable(
  'contact_messages',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    topic: text('topic').$type<ContactTopic>().notNull(),
    // Free-text "what's this about" line from the form. Nullable: the
    // topic-only flow (and older clients) submit without it. Also holds the
    // serialized `#tag` routing chips the support form sends.
    subject: text('subject'),
    message: text('message').notNull(),
    // Visitor country auto-detected from their IP on the /contact page and
    // submitted as a locked field — a hint for the operator. Nullable when
    // it couldn't be resolved (localhost, unknown block).
    country: text('country'),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    // ── Support-ticket columns (0045) ──
    // Lifecycle status. NOT NULL with a default so every row has one; only
    // meaningful for ticketed rows (ticket_number IS NOT NULL).
    status: text('status').$type<TicketStatus>().notNull().default('no_response'),
    // Human-facing ticket number stored WITHOUT the leading '#'
    // (e.g. SUP260629-000001). NULL for non-ticketed contact messages.
    // UNIQUE — a unique index on a nullable column lets the many
    // non-ticket rows keep NULL while ticketed rows stay unique.
    ticketNumber: text('ticket_number'),
    // Primary topic code (SUP/BIL/TEC/SLF). NULL for non-ticketed rows.
    topicCode: text('topic_code').$type<TicketTopicCode>(),
    // Operator the ticket is assigned to (free-text handle). NULL = unassigned.
    assignedTo: text('assigned_to'),
    // Internal operator-only triage notes. NEVER surfaced to the user.
    operatorNotes: text('operator_notes'),
    createdAt: createdAt(),
    handledAt: ts('handled_at'),
  },
  (t) => ({
    createdIdx: index('contact_messages_created_idx').on(t.createdAt),
    // Nullable-unique: multiple NULLs allowed (non-ticket rows), ticketed
    // rows are globally unique.
    ticketNumberIdx: uniqueIndex('contact_messages_ticket_number_idx').on(t.ticketNumber),
  }),
);
export type ContactMessage = typeof contactMessages.$inferSelect;

/* ─── ticket_counters (daily, per-topic-code sequence) ───────────── */
// One row per (topic_code, day). The counter is atomically incremented by
// an INSERT ... ON CONFLICT DO UPDATE on ticket creation, giving a
// race-safe, gap-tolerant sequence that resets to 1 each new day per code.
export const ticketCounters = pgTable(
  'ticket_counters',
  {
    topicCode: text('topic_code').notNull(),
    // Calendar day (UTC) the sequence belongs to. String mode → 'YYYY-MM-DD'.
    day: date('day', { mode: 'string' }).notNull(),
    counter: integer('counter').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.topicCode, t.day] }),
  }),
);
export type TicketCounter = typeof ticketCounters.$inferSelect;

/* ─── contact_message_replies (ticket thread) ────────────────────── */
// Append-only thread of messages on a ticket. An operator reply emails the
// sender; a user reply (future inbound path) is recorded too. Cascades when
// the parent contact_messages row is deleted.
export const contactMessageReplies = pgTable(
  'contact_message_replies',
  {
    id: id(),
    messageId: text('message_id')
      .notNull()
      .references(() => contactMessages.id, { onDelete: 'cascade' }),
    author: text('author').$type<TicketReplyAuthor>().notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    messageIdx: index('contact_message_replies_message_idx').on(t.messageId),
  }),
);
export type ContactMessageReply = typeof contactMessageReplies.$inferSelect;

/* ─── platform_settings (single-row dashboard-controllable flags) ─── */
// Key/value JSONB store for platform-level flags an admin needs to flip
// without a container restart. Today: `openSignups` (boolean). Future:
// rate-limit overrides, maintenance-mode toggle, feature flags.
//
// Reads cache in-process for 60s — the auth signup hot path touches
// this on every signup attempt and we don't want a DB roundtrip there
// per request. Writes invalidate the cache (single-process; on multi-
// instance the next read picks up the change within the TTL window).

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: updatedAt(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

/* ─── signup_allowlist (invite-only beta gate) ────────────────────── */
// When BRIVEN_OPEN_SIGNUPS=false (the default for the private beta),
// Better Auth's user.create hook rejects any email not on this list. An
// admin manages entries via /dashboard/admin/allowlist. accepted_at is
// stamped once the email signs in for the first time so the operator
// can see who's claimed their invite vs who's still pending.

export const signupAllowlist = pgTable(
  'signup_allowlist',
  {
    id: id(),
    email: text('email').notNull(),
    invitedBy: text('invited_by').references(() => users.id, { onDelete: 'set null' }),
    // Column is `invited_at` (migration 0024). Do NOT use the createdAt()
    // helper here — it hard-codes the column name to `created_at`, which does
    // not exist on this table, so every addToAllowlist/listAllowlist query
    // failed against the real DB ("column created_at does not exist").
    invitedAt: ts('invited_at').defaultNow().notNull(),
    acceptedAt: ts('accepted_at'),
    notes: text('notes'),
  },
  (t) => ({
    emailIdx: uniqueIndex('signup_allowlist_email_idx').on(t.email),
  }),
);

/* ─── webhook_subscribers (customer-defined outbound webhooks) ────── */
// Platform → customer fan-out: when briven emits an event (abuse report
// opened, deploy succeeded/failed, tier changed) we POST a signed payload
// to every matching subscriber's target_url. Customers verify our
// signature exactly the way external sources verify theirs on the
// inbound path — same HMAC scheme, same X-Briven-* headers.

export const webhookOutboundStatus = [
  'pending',
  'ok',
  'failed',
  'cancelled',
] as const;
export type WebhookOutboundStatus = (typeof webhookOutboundStatus)[number];

export const webhookSubscribers = pgTable(
  'webhook_subscribers',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    targetUrl: text('target_url').notNull(),
    // Comma-separated event-type allowlist. `*` matches everything.
    // Concrete values today: abuse.report.opened, deploy.succeeded,
    // deploy.failed, tier.changed, project.suspended.
    eventTypes: text('event_types').notNull().default('*'),
    // Same AES-256-GCM scheme as inbound webhook_endpoints. Plaintext
    // returned once at create + on rotate.
    signingSecretEncrypted: text('signing_secret_encrypted').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    lastDeliveryAt: ts('last_delivery_at'),
    lastDeliveryStatus: text('last_delivery_status').$type<WebhookOutboundStatus>(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    projectNameIdx: uniqueIndex('webhook_subscribers_project_name_idx')
      .on(t.projectId, t.name)
      .where(sql`deleted_at is null`),
    projectIdx: index('webhook_subscribers_project_idx')
      .on(t.projectId)
      .where(sql`deleted_at is null`),
  }),
);

/* ─── webhook_outbound_deliveries (per-attempt retry log) ─────────── */
export const webhookOutboundDeliveries = pgTable(
  'webhook_outbound_deliveries',
  {
    id: id(),
    subscriberId: text('subscriber_id')
      .notNull()
      .references(() => webhookSubscribers.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // Stable event id — survives across retry rows. The customer's
    // function can dedupe on this header (X-Briven-Event-Id).
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    // The serialised JSON we POST. Stored once at publish so retries
    // send identical bytes even if upstream state has moved on.
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').$type<WebhookOutboundStatus>().notNull().default('pending'),
    attemptCount: text('attempt_count').notNull().default('0'),
    // Set on every state transition. Dispatcher claims rows where
    // next_attempt_at <= now() AND status = 'pending'.
    nextAttemptAt: ts('next_attempt_at').notNull(),
    lastAttemptAt: ts('last_attempt_at'),
    statusCode: text('status_code'),
    durationMs: text('duration_ms'),
    errorMessage: text('error_message'),
    createdAt: createdAt(),
  },
  (t) => ({
    dueIdx: index('webhook_outbound_deliveries_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`status = 'pending'`),
    subscriberIdx: index('webhook_outbound_deliveries_subscriber_idx').on(
      t.subscriberId,
      t.createdAt,
    ),
    projectIdx: index('webhook_outbound_deliveries_project_idx').on(t.projectId, t.createdAt),
    eventIdIdx: index('webhook_outbound_deliveries_event_id_idx').on(t.eventId),
  }),
);

/* ─── project_files (S3-compatible object storage metadata) ──────── */
export const projectFiles = pgTable(
  'project_files',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // Human-facing name (the original filename when known). Not unique
    // — same name twice is fine, identity is the id + object key.
    name: text('name').notNull(),
    // Storage object key — `projects/<projectId>/<fileId>`. Set once on
    // create; never edited. The id alone is enough to derive this but
    // we persist it so future-us doesn't depend on the derivation rule.
    objectKey: text('object_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: text('size_bytes').notNull(),
    // sha256 of the object body, populated on confirm. Null while the
    // upload is mid-flight. Stays null when we don't compute it.
    checksumSha256: text('checksum_sha256'),
    uploadedBy: text('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    projectIdx: index('project_files_project_idx').on(t.projectId).where(sql`deleted_at is null`),
    objectKeyIdx: uniqueIndex('project_files_object_key_idx').on(t.objectKey),
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
export type EmailSuppression = typeof emailSuppressions.$inferSelect;
export type NewEmailSuppression = typeof emailSuppressions.$inferInsert;
export type DeployHistoryEntry = typeof deployHistory.$inferSelect;
export type NewDeployHistoryEntry = typeof deployHistory.$inferInsert;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;
export type ProjectSchedule = typeof projectSchedules.$inferSelect;
export type NewProjectSchedule = typeof projectSchedules.$inferInsert;
export type ProjectFile = typeof projectFiles.$inferSelect;
export type NewProjectFile = typeof projectFiles.$inferInsert;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
export type WebhookSubscriber = typeof webhookSubscribers.$inferSelect;
export type NewWebhookSubscriber = typeof webhookSubscribers.$inferInsert;
export type WebhookOutboundDelivery = typeof webhookOutboundDeliveries.$inferSelect;
export type NewWebhookOutboundDelivery = typeof webhookOutboundDeliveries.$inferInsert;
export type AbuseReport = typeof abuseReports.$inferSelect;
export type NewAbuseReport = typeof abuseReports.$inferInsert;
export type SignupAllowlistEntry = typeof signupAllowlist.$inferSelect;
export type NewSignupAllowlistEntry = typeof signupAllowlist.$inferInsert;
export type PlatformSetting = typeof platformSettings.$inferSelect;
export type NewPlatformSetting = typeof platformSettings.$inferInsert;
export type Incident = typeof incidents.$inferSelect;
export type NewIncident = typeof incidents.$inferInsert;
export type MigrationRequest = typeof migrationRequests.$inferSelect;
export type NewMigrationRequest = typeof migrationRequests.$inferInsert;

/* ─── marketing_events (funnel tracking for /migrate) ────────────── */
export const marketingEventTypes = [
  'migrate_view',
  'migrate_lead_submitted',
] as const;
export type MarketingEventType = (typeof marketingEventTypes)[number];

export const marketingEvents = pgTable(
  'marketing_events',
  {
    id: id(),
    eventType: text('event_type').$type<MarketingEventType>().notNull(),
    source: text('source').notNull(),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => ({
    lookupIdx: index('marketing_events_lookup_idx').on(t.source, t.eventType, t.createdAt),
  }),
);

export type MarketingEvent = typeof marketingEvents.$inferSelect;
export type NewMarketingEvent = typeof marketingEvents.$inferInsert;

/* ─── briven_auth_sdk_keys (SDK keys issued from the Auth → API Keys panel) ─ */
// Different shape than `api_keys` (which is for CLI / deploy auth): SDK
// keys carry an `auth`-specific scope vocabulary and a `pk_briven_auth_`
// plaintext prefix so they're recognisable in logs + grep. Plaintext is
// returned exactly once on creation; only a sha-256 hex digest persists.
// The bare `prefix` column is the constant `pk_briven_auth_` — kept as a
// column rather than hard-coded so a future v2 key scheme can coexist
// without a migration.
// NB: schema-diff requires `pnpm --filter @briven/api db:generate` in a
// real TTY (road-to-ga.md §2.9) to land an actual migration; until that
// runs the column-set above is only authoritative in TypeScript.

export const brivenAuthSdkKeyScope = ['read', 'read-write', 'admin'] as const;
export type BrivenAuthSdkKeyScope = (typeof brivenAuthSdkKeyScope)[number];

export const brivenAuthSdkKeys = pgTable(
  'briven_auth_sdk_keys',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // Nullable + ON DELETE SET NULL so a GDPR hard-delete of the creating
    // user doesn't 23503-block on this key (audit Theme 0). Was NOT NULL +
    // NO ACTION.
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    // sha-256 hex digest of the plaintext token. Never the plaintext itself.
    hash: text('hash').notNull(),
    // Plaintext prefix — currently always `pk_briven_auth_`. Stored so we
    // can render `<prefix>•••<suffix>` for the dashboard hint without
    // baking the constant into UI code.
    prefix: text('prefix').notNull(),
    // Last 4 chars of the plaintext — safe to display.
    suffix: varchar('suffix', { length: 4 }).notNull(),
    scope: text('scope').$type<BrivenAuthSdkKeyScope>().notNull().default('read'),
    // AES-256-GCM ciphertext of the plaintext key, encrypted at rest with
    // BRIVEN_ENCRYPTION_KEY (services/project-env.ts wire format). Lets an
    // owner copy the full key again later via the authenticated + audited
    // reveal endpoint — the value is NEVER returned in list/create masks and
    // never rendered in HTML. NULL for keys minted before 0039: those cannot
    // be revealed (rotate to get a copyable key). `hash` stays the only
    // auth-verification mechanism; this column is copy-again only.
    encryptedKey: text('encrypted_key'),
    lastUsedAt: ts('last_used_at'),
    expiresAt: ts('expires_at'),
    createdAt: createdAt(),
    revokedAt: ts('revoked_at'),
  },
  (t) => ({
    hashIdx: uniqueIndex('briven_auth_sdk_keys_hash_idx').on(t.hash),
    projectIdx: index('briven_auth_sdk_keys_project_idx').on(t.projectId),
  }),
);

export type BrivenAuthSdkKey = typeof brivenAuthSdkKeys.$inferSelect;
export type NewBrivenAuthSdkKey = typeof brivenAuthSdkKeys.$inferInsert;

/* ─── mcp_keys (B Phase 5 — MCP / Agent-Access keys) ───────────────────── */
// Keys an agent / MCP client presents to reach a project once MCP access is
// turned on for it. Same one-time-reveal discipline as api_keys and
// briven_auth_sdk_keys: the plaintext is returned exactly once on issue; only
// a sha-256 hex digest persists. `prefix` is the constant `pk_briven_mcp_`
// (kept as a column so a future v2 scheme can coexist without a migration);
// `suffix` is the safe-to-show last 4 chars for the `<prefix>•••<suffix>`
// dashboard hint. `enabled` is the per-key live switch — revoke flips it false
// AND stamps revoked_at. This is only the access SURFACE; the MCP socket
// server that consumes these keys is a separate track.
export const mcpKeyScope = ['read', 'read-write', 'admin'] as const;
export type McpKeyScope = (typeof mcpKeyScope)[number];

export const mcpKeys = pgTable(
  'mcp_keys',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // sha-256 hex digest of the plaintext token. Never the plaintext itself.
    hash: text('hash').notNull(),
    // Plaintext prefix — currently always `pk_briven_mcp_`.
    prefix: text('prefix').notNull(),
    // Last 4 chars of the plaintext — safe to display.
    suffix: varchar('suffix', { length: 4 }).notNull(),
    scope: text('scope').$type<McpKeyScope>().notNull().default('read'),
    enabled: boolean('enabled').notNull().default(true),
    // Nullable + ON DELETE SET NULL so a GDPR hard-delete of the creating
    // user doesn't 23503-block on this key (audit Theme 0). Was NOT NULL +
    // NO ACTION.
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => ({
    hashIdx: uniqueIndex('mcp_keys_hash_idx').on(t.hash),
    projectIdx: index('mcp_keys_project_idx').on(t.projectId),
  }),
);

export type McpKey = typeof mcpKeys.$inferSelect;
export type NewMcpKey = typeof mcpKeys.$inferInsert;

/* ─── project_auto_snapshot_settings (automatic scheduled snapshots) ─ */
// One row per project that has automatic save-points configured. Drives
// the auto-snapshot worker: a project is "due" when enabled = true and
// next_run_at <= now(). The worker takes an `auto` snapshot (see
// services/snapshots.ts), then prunes auto snapshots beyond
// retention_count — manual snapshots are never touched. Storing the
// schedule state here (not in the per-project data-plane schema) keeps
// the due-scan a single cheap control-plane query.
export const autoSnapshotFrequency = ['daily', 'twice_daily'] as const;
export type AutoSnapshotFrequency = (typeof autoSnapshotFrequency)[number];

export const autoSnapshotRunStatus = ['ok', 'error', 'skipped'] as const;
export type AutoSnapshotRunStatus = (typeof autoSnapshotRunStatus)[number];

export const projectAutoSnapshotSettings = pgTable(
  'project_auto_snapshot_settings',
  {
    id: id(),
    // One settings row per project. Unique so upsert-on-project is safe.
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(false),
    frequency: text('frequency').$type<AutoSnapshotFrequency>().notNull().default('daily'),
    // Keep the last N automatic snapshots; older auto snapshots are pruned
    // after each successful run. Manual snapshots are out of scope and
    // never counted or pruned.
    retentionCount: integer('retention_count').notNull().default(7),
    // The worker claims rows by checking next_run_at <= now() and bumping
    // it forward in the same transaction. Indexed on the enabled subset so
    // the due-scan stays cheap as the table grows.
    nextRunAt: ts('next_run_at').notNull(),
    lastRunAt: ts('last_run_at'),
    lastRunStatus: text('last_run_status').$type<AutoSnapshotRunStatus>(),
    lastRunError: text('last_run_error'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    projectIdx: uniqueIndex('project_auto_snapshot_settings_project_idx').on(t.projectId),
    dueIdx: index('project_auto_snapshot_settings_due_idx')
      .on(t.nextRunAt)
      .where(sql`enabled = true`),
  }),
);

export type ProjectAutoSnapshotSettings = typeof projectAutoSnapshotSettings.$inferSelect;
export type NewProjectAutoSnapshotSettings = typeof projectAutoSnapshotSettings.$inferInsert;

/* ─── tenant_secrets (per-tenant encrypted secrets — OAuth client secrets) ─ */
// Persistence layer for the Layer-2 secret primitive in
// services/tenant-secret-store.ts (HKDF-SHA256 per-tenant key +
// AES-256-GCM). One row per (project, service, name) secret — e.g. a
// project's `google_client_secret` for the `auth` service. The ciphertext
// in `encrypted_value` is the base64 blob `encryptTenantSecret` returns;
// it is NEVER read directly — always through services/tenant-secrets.ts
// which wraps decrypt. `service` stores the TenantService string
// ('auth' | 'pay') so a single table serves both briven auth and pay
// without colliding (key derivation is service-scoped). Control-plane
// table (Postgres 17), so `onConflictDoUpdate` upserts are available.
export const tenantSecrets = pgTable(
  'tenant_secrets',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // TenantService discriminator ('auth' | 'pay'). Stored as text so the
    // table doesn't need a migration when a third service appears.
    service: text('service').notNull(),
    // Logical secret name within the (project, service) namespace, e.g.
    // 'google_client_secret', 'github_client_secret'.
    name: text('name').notNull(),
    // base64 ciphertext from encryptTenantSecret. Never read directly.
    encryptedValue: text('encrypted_value').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    projectServiceNameIdx: uniqueIndex('tenant_secrets_project_service_name_idx').on(
      t.projectId,
      t.service,
      t.name,
    ),
    projectServiceIdx: index('tenant_secrets_project_service_idx').on(t.projectId, t.service),
  }),
);

export type TenantSecret = typeof tenantSecrets.$inferSelect;
export type NewTenantSecret = typeof tenantSecrets.$inferInsert;
