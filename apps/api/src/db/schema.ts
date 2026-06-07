/**
 * Control-plane meta-DB schema.
 *
 * Per CLAUDE.md §8.1: every table has `id` (ULID PK), `created_at`,
 * `updated_at`, and `deleted_at` (soft-delete). The id column is
 * `varchar(36)` — briven-managed rows store prefixed ULIDs (28 chars),
 * Better Auth tables store its 32-char nanoids, both fit cleanly.
 *
 * Better Auth also reads / writes `users`, `accounts`, `sessions`, `verifications`
 * via its drizzle adapter; schema here matches Better Auth's expected shape so
 * the adapter works without translation.
 *
 * @README-BRIVEN ADR 0001 — migrated from pg-core to mysql-core.
 *
 *   - `text('id').primaryKey()` → `varchar('id', { length: 36 }).primaryKey()`
 *     MySQL cannot primary-key on TEXT.
 *   - `timestamp(..., { withTimezone: true, mode: 'date' })` →
 *     `timestamp(..., { mode: 'date', fsp: 3 })`
 *     MySQL TIMESTAMP is always UTC internally; `fsp: 3` = millisecond precision.
 *   - `jsonb` → `json` — MySQL has JSON, no JSONB.
 *   - `integer` → `int`
 *   - `uniqueIndex(...).where(sql\`...\`)` — MySQL does not support partial
 *     unique indexes. Dropped the `.where()` clause; uniqueness for
 *     soft-deleted rows is enforced at the application layer (see ADR §
 *     "Partial unique indexes").
 *   - `index(...).where(sql\`...\`)` — MySQL does not support partial
 *     indexes at all. Dropped the `.where()` clause; the index covers all
 *     rows. Acceptable for the control plane's modest row counts.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

// Per CLAUDE.md §8.1 we use prefixed ULIDs (28 chars) for briven-managed
// rows, but Better Auth-managed tables use its own 32-char nanoid scheme.
// `varchar(36)` accommodates both with headroom. MySQL cannot PK on TEXT
// so we cannot keep the old `text('id').primaryKey()` pattern.
const id = () => varchar('id', { length: 36 }).primaryKey();
const ts = (name: string) => timestamp(name, { mode: 'date', fsp: 3 });
const createdAt = () => ts('created_at').defaultNow().notNull();
const updatedAt = () => ts('updated_at').defaultNow().notNull();
const deletedAt = () => ts('deleted_at');

/* ─── users ──────────────────────────────────────────────────────── */
export const users = mysqlTable(
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
    // KYC — required before paid checkout under EU AML. Stored as
    // ISO yyyy-mm-dd text; the underlying column is DATE.
    dateOfBirth: text('date_of_birth'),
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
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_idx').on(t.email),
  }),
);

/* ─── accounts (Better Auth: provider-linked credentials) ─────────── */
export const accounts = mysqlTable(
  'accounts',
  {
    id: id(),
    userId: varchar('user_id', { length: 36 })
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
export const sessions = mysqlTable(
  'sessions',
  {
    id: id(),
    userId: varchar('user_id', { length: 36 })
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
export const verifications = mysqlTable(
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

export const organizations = mysqlTable(
  'organizations',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    // True for the auto-created first org per user. Lets the UI keep a
    // single-org implicit UX until Phase 3 adds a switcher.
    personal: boolean('personal').notNull().default(false),
    createdBy: varchar('created_by', { length: 36 })
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

export const orgMembers = mysqlTable(
  'org_members',
  {
    orgId: varchar('org_id', { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 36 })
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

export const projects = mysqlTable(
  'projects',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    orgId: varchar('org_id', { length: 36 })
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

export const projectMembers = mysqlTable(
  'project_members',
  {
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 36 })
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

export const subscriptions = mysqlTable(
  'subscriptions',
  {
    id: id(),
    orgId: varchar('org_id', { length: 36 })
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
export const projectInvitations = mysqlTable(
  'project_invitations',
  {
    id: id(),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').$type<MemberRole>().notNull().default('developer'),
    // SHA-256 hash of the single-use accept token; plaintext only rides
    // in the invite email and the recipient's URL.
    tokenHash: text('token_hash').notNull(),
    invitedBy: varchar('invited_by', { length: 36 }).references(() => users.id),
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
export const orgInvitations = mysqlTable(
  'org_invitations',
  {
    id: id(),
    orgId: varchar('org_id', { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').$type<OrgRole>().notNull().default('developer'),
    tokenHash: text('token_hash').notNull(),
    invitedBy: varchar('invited_by', { length: 36 }).references(() => users.id),
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

/* ─── api_keys ─────────────────────────────────────────────────────── */
export const apiKeys = mysqlTable(
  'api_keys',
  {
    id: id(),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    createdBy: varchar('created_by', { length: 36 })
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    // sha-256 hex digest of the plaintext token. The plaintext is
    // returned exactly once at create time and never persisted.
    hash: text('hash').notNull(),
    // Plaintext prefix — currently always `pk_briven_`. Stored so we
    // can render `<prefix>•••<suffix>` in the dashboard without baking
    // the constant into every UI layer.
    prefix: text('prefix').notNull(),
    // Last 4 chars of the plaintext — safe to display.
    suffix: varchar('suffix', { length: 4 }).notNull(),
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

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

/* ─── project_schedules ────────────────────────────────────────────── */
export const scheduleStatus = ['active', 'paused', 'disabled'] as const;
export type ScheduleStatus = (typeof scheduleStatus)[number];

/**
 * @README-BRIVEN Partial unique index removed.
 *
 * The original pg-core schema had:
 *   uniqueIndex('project_schedules_project_name_idx')
 *     .on(t.projectId, t.slug)
 *     .where(sql`deleted_at is null`)
 *
 * MySQL does not support partial unique indexes. The unique constraint
 * now covers all rows (including soft-deleted ones). Application-level
 * enforcement must prevent duplicate (projectId, slug) among non-deleted
 * rows — see ADR 0001 § "Partial unique indexes".
 */
export const projectSchedules = mysqlTable(
  'project_schedules',
  {
    id: id(),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    // cron expression (5-field quartz format).
    cronExpression: text('cron_expression').notNull(),
    // The function this schedule invokes.
    functionName: text('function_name').notNull(),
    // JSON payload POSTed to the function.
    payload: json('payload').$type<Record<string, unknown>>().default({}),
    status: text('status').$type<ScheduleStatus>().notNull().default('active'),
    lastInvokedAt: ts('last_invoked_at'),
    nextInvocationAt: ts('next_invocation_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    // @README-BRIVEN: was partial unique (WHERE deleted_at IS NULL).
    // Now full unique — app must enforce soft-delete uniqueness.
    projectNameIdx: uniqueIndex('project_schedules_project_name_idx').on(t.projectId, t.slug),
    projectIdx: index('project_schedules_project_idx').on(t.projectId),
    nextIdx: index('project_schedules_next_idx').on(t.nextInvocationAt),
  }),
);

export type ProjectSchedule = typeof projectSchedules.$inferSelect;
export type NewProjectSchedule = typeof projectSchedules.$inferInsert;

/* ─── platform_settings ────────────────────────────────────────────── */
export const platformSettings = mysqlTable(
  'platform_settings',
  {
    key: varchar('key', { length: 128 }).primaryKey(),
    value: json('value').notNull(),
    updatedBy: varchar('updated_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
);

export type PlatformSetting = typeof platformSettings.$inferSelect;
export type NewPlatformSetting = typeof platformSettings.$inferInsert;

/* ─── deploy_history ───────────────────────────────────────────────── */
export const deploymentStatus = [
  'pending',
  'schema_applied',
  'schema_failed',
  'complete',
  'failed',
] as const;
export type DeploymentStatus = (typeof deploymentStatus)[number];

export const deployHistory = mysqlTable(
  'deploy_history',
  {
    id: id(),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    deploymentId: text('deployment_id'),
    status: text('status').$type<DeploymentStatus>().notNull().default('pending'),
    schemaDiffSummary: json('schema_diff_summary'),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    errorMessage: text('error_message'),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    // @README-BRIVEN: was partial index WHERE deleted_at IS NULL.
    // MySQL doesn't support partial indexes; full index is acceptable.
    projectCreatedIdx: index('deploy_history_project_created_idx').on(t.projectId, t.createdAt),
  }),
);

export type DeployHistoryEntry = typeof deployHistory.$inferSelect;
export type NewDeployHistoryEntry = typeof deployHistory.$inferInsert;

/* ─── deployments ──────────────────────────────────────────────────── */
export const deployments = mysqlTable(
  'deployments',
  {
    id: id(),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    triggeredBy: varchar('triggered_by', { length: 36 }).references(() => users.id),
    apiKeyId: varchar('api_key_id', { length: 36 }).references(() => apiKeys.id),
    status: text('status').$type<DeploymentStatus>().notNull().default('pending'),
    schemaDiffSummary: json('schema_diff_summary'),
    // Full schema definition as declared by the user at deploy time. Every
    // deployment is a self-contained snapshot so rollbacks and diffs don't
    // depend on reconstructing from a chain of migrations.
    schemaSnapshot: json('schema_snapshot'),
    functionCount: varchar('function_count', { length: 12 }),
    functionNames: json('function_names'),
    // Map of `<relative path under briven/functions/>` → TS source. Runtime
    // fetches this via the internal bundle endpoint and writes the files to
    // a temp dir before importing. Phase 1 stores raw source; Phase 2 moves
    // to a content-addressed tarball in MinIO once bundles exceed a few MB.
    bundle: json('bundle'),
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
export const functionLogs = mysqlTable(
  'function_logs',
  {
    id: id(),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    deploymentId: varchar('deployment_id', { length: 36 })
      .notNull()
      .references(() => deployments.id, { onDelete: 'cascade' }),
    invocationId: text('invocation_id').notNull(),
    functionName: varchar('function_name', { length: 128 }).notNull(),
    status: varchar('status', { length: 8 }).notNull(),
    durationMs: varchar('duration_ms', { length: 12 }).notNull(),
    touchedTables: json('touched_tables').notNull(),
    userLogsJson: json('user_logs_json').notNull(),
    errCode: text('err_code'),
    errMessage: text('err_message'),
    createdAt: createdAt(),
  },
  (t) => ({
    projectCreatedIdx: index('function_logs_project_created_idx').on(t.projectId, t.createdAt),
  }),
);

/* ─── audit_logs ──────────────────────────────────────────────────── */
export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: id(),
    actorId: varchar('actor_id', { length: 36 }).references(() => users.id),
    projectId: varchar('project_id', { length: 36 }).references(() => projects.id),
    action: text('action').notNull(),
    // SHA-256 hash of the caller IP — we never store raw IPs (CLAUDE.md §5.1).
    ipHash: varchar('ip_hash', { length: 64 }),
    userAgent: text('user_agent'),
    metadata: json('metadata'),
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

export const emailSuppressions = mysqlTable(
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

export const usageEvents = mysqlTable(
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
    projectPeriodIdx: uniqueIndex('usage_events_project_period_idx').on(
      t.projectId,
      t.metric,
      t.periodStart,
    ),
    pushStatusIdx: index('usage_events_push_status_idx').on(t.polarPushStatus),
  }),
);

export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;

/* ─── webhook_endpoints (customer-inbound webhooks) ────────────────── */
export const webhookDeliveryStatus = [
  'ok',
  'invoke_error',
  'signature_mismatch',
  'timeout',
] as const;
export type WebhookDeliveryStatus = (typeof webhookDeliveryStatus)[number];

/**
 * @README-BRIVEN Partial unique + partial regular indexes removed.
 *
 * MySQL does not support partial indexes. The unique constraint on
 * (projectId, name) now covers soft-deleted rows too — application-layer
 * enforcement must prevent name collisions among non-deleted endpoints.
 */
export const webhookEndpoints = mysqlTable(
  'webhook_endpoints',
  {
    id: id(),
    projectId: varchar('project_id', { length: 36 })
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
    createdBy: varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    // @README-BRIVEN: was partial unique (WHERE deleted_at IS NULL).
    projectNameIdx: uniqueIndex('webhook_endpoints_project_name_idx').on(t.projectId, t.name),
    // @README-BRIVEN: was partial index (WHERE deleted_at IS NULL).
    projectIdx: index('webhook_endpoints_project_idx').on(t.projectId),
  }),
);

/* ─── webhook_deliveries (per-request audit log) ──────────────────── */
export const webhookDeliveries = mysqlTable(
  'webhook_deliveries',
  {
    id: id(),
    endpointId: varchar('endpoint_id', { length: 36 })
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    // Denormalised — saves a join when the dashboard's per-project
    // "recent deliveries" view loads, and lets the per-project retention
    // cron prune rows without walking the endpoints table.
    projectId: varchar('project_id', { length: 36 })
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

export const abuseReports = mysqlTable(
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
    projectId: varchar('project_id', { length: 36 }).references(() => projects.id, { onDelete: 'set null' }),
    triagedAt: ts('triaged_at'),
    triagedBy: varchar('triaged_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
    triageNotes: text('triage_notes'),
    resolvedAt: ts('resolved_at'),
    resolvedBy: varchar('resolved_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
    resolveNotes: text('resolve_notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    statusIdx: index('abuse_reports_status_idx').on(t.status, t.createdAt),
    severityIdx: index('abuse_reports_severity_idx').on(t.severity, t.createdAt),
    // @README-BRIVEN: was partial index (WHERE project_id IS NOT NULL).
    projectIdx: index('abuse_reports_project_idx').on(t.projectId),
  }),
);

/* ─── incidents (operator-published status events) ─────────────────── */
// Hand-curated platform-incident log. An admin opens an incident when
// something customer-impacting starts, edits the narrative as the
// situation unfolds, and resolves it when restored. The public status
// page and RSS feed read from this table.

export const incidentSeverity = ['critical', 'major', 'minor', 'maintenance'] as const;
export type IncidentSeverity = (typeof incidentSeverity)[number];

export const incidents = mysqlTable(
  'incidents',
  {
    id: id(),
    startedAt: ts('started_at').notNull(),
    resolvedAt: ts('resolved_at'),
    severity: text('severity').$type<IncidentSeverity>().notNull(),
    // List of affected services: 'api' | 'realtime' | 'runtime' | 'web'
    // | 'docs' | 'all'. Stored as json so we can grow the vocabulary
    // without a migration.
    services: json('services').$type<readonly string[]>().notNull(),
    summary: text('summary').notNull(),
    postmortem: text('postmortem').notNull().default(''),
    createdBy: varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    startedIdx: index('incidents_started_idx').on(t.startedAt),
    // @README-BRIVEN: was partial index (WHERE resolved_at IS NULL).
    activeIdx: index('incidents_active_idx').on(t.startedAt),
  }),
);

/* ─── migration_requests (customer-initiated platform import intake) ── */
// One row per dashboard-wizard submission. The wizard at
// /dashboard/projects/new/migrate collects the target platform, source
// URL, and contact email, then the api writes one row here. An operator
// later triages the row and reaches out via the contact email.

export const migrationRequestStatus = ['new', 'contacted', 'scheduled', 'completed', 'declined'] as const;
export type MigrationRequestStatus = (typeof migrationRequestStatus)[number];

export const migrationRequests = mysqlTable(
  'migration_requests',
  {
    id: id(),
    sourcePlatform: text('source_platform').notNull(),
    sourceUrl: text('source_url'),
    contactEmail: text('contact_email').notNull(),
    notes: text('notes'),
    status: text('status').$type<MigrationRequestStatus>().notNull().default('new'),
    triagedBy: varchar('triaged_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
    triagedAt: ts('triaged_at'),
    triageNotes: text('triage_notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    statusIdx: index('migration_requests_status_idx').on(t.status, t.createdAt),
  }),
);

export type MigrationRequest = typeof migrationRequests.$inferSelect;
export type NewMigrationRequest = typeof migrationRequests.$inferInsert;

/* ─── signup_allowlist ─────────────────────────────────────────────── */
// Operator-level gating for the private phase. An invited email may
// create an account once; non-allowlisted signups get a "private
// preview" message. The dashboard admin panel CRUDs these; the operator
// can see who's claimed their invite vs who's still pending.

export const signupAllowlist = mysqlTable(
  'signup_allowlist',
  {
    id: id(),
    email: text('email').notNull(),
    invitedBy: varchar('invited_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
    invitedAt: createdAt(),
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

/**
 * @README-BRIVEN Partial unique + partial regular indexes removed.
 * Application-layer enforcement for (projectId, name) uniqueness among
 * non-deleted subscribers.
 */
export const webhookSubscribers = mysqlTable(
  'webhook_subscribers',
  {
    id: id(),
    projectId: varchar('project_id', { length: 36 })
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
    createdBy: varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    // @README-BRIVEN: was partial unique (WHERE deleted_at IS NULL).
    projectNameIdx: uniqueIndex('webhook_subscribers_project_name_idx').on(t.projectId, t.name),
    // @README-BRIVEN: was partial index (WHERE deleted_at IS NULL).
    projectIdx: index('webhook_subscribers_project_idx').on(t.projectId),
  }),
);

/* ─── webhook_outbound_deliveries (per-attempt retry log) ─────────── */
export const webhookOutboundDeliveries = mysqlTable(
  'webhook_outbound_deliveries',
  {
    id: id(),
    subscriberId: varchar('subscriber_id', { length: 36 })
      .notNull()
      .references(() => webhookSubscribers.id, { onDelete: 'cascade' }),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // Stable event id — survives across retry rows. The customer's
    // function can dedupe on this header (X-Briven-Event-Id).
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    // The serialised JSON we POST. Stored once at publish so retries
    // send identical bytes even if upstream state has moved on.
    payload: json('payload').$type<Record<string, unknown>>().notNull(),
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
    // @README-BRIVEN: was partial index (WHERE status = 'pending').
    dueIdx: index('webhook_outbound_deliveries_due_idx').on(t.nextAttemptAt),
    subscriberIdx: index('webhook_outbound_deliveries_subscriber_idx').on(
      t.subscriberId,
      t.createdAt,
    ),
    projectIdx: index('webhook_outbound_deliveries_project_idx').on(t.projectId, t.createdAt),
    eventIdIdx: index('webhook_outbound_deliveries_event_id_idx').on(t.eventId),
  }),
);

/* ─── project_files (S3-compatible object storage metadata) ──────── */
export const projectFiles = mysqlTable(
  'project_files',
  {
    id: id(),
    projectId: varchar('project_id', { length: 36 })
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
    uploadedBy: varchar('uploaded_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    // @README-BRIVEN: was partial index (WHERE deleted_at IS NULL).
    projectIdx: index('project_files_project_idx').on(t.projectId),
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

export const marketingEvents = mysqlTable(
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

export const brivenAuthSdkKeys = mysqlTable(
  'briven_auth_sdk_keys',
  {
    id: id(),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    createdBy: varchar('created_by', { length: 36 })
      .notNull()
      .references(() => users.id),
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
