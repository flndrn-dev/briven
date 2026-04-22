/**
 * Control-plane meta-DB schema.
 *
 * Per CLAUDE.md §8.1: every table has `id` (ULID varchar(26) PK — but prefixed
 * in practice, so varchar(30) for a prefix + underscore + 26-char ULID),
 * `created_at`, `updated_at`, and `deleted_at` (soft-delete).
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

const id = () => varchar('id', { length: 30 }).primaryKey();
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
    userId: varchar('user_id', { length: 30 })
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
    userId: varchar('user_id', { length: 30 })
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

/* ─── projects ────────────────────────────────────────────────────── */
export const projectTier = ['free', 'pro', 'team'] as const;
export type ProjectTier = (typeof projectTier)[number];

export const projects = pgTable(
  'projects',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    ownerId: varchar('owner_id', { length: 30 })
      .notNull()
      .references(() => users.id),
    region: text('region').notNull().default('eu-west-1'),
    tier: text('tier').$type<ProjectTier>().notNull().default('free'),
    shardId: text('shard_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    slugIdx: uniqueIndex('projects_slug_idx').on(t.slug),
    ownerIdx: index('projects_owner_idx').on(t.ownerId),
  }),
);

/* ─── project_members (Phase 3 RBAC — columns exist, roles stubbed) ─ */
export const memberRole = ['owner', 'admin', 'developer', 'viewer'] as const;
export type MemberRole = (typeof memberRole)[number];

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: varchar('project_id', { length: 30 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 30 })
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

/* ─── api_keys / deploy keys ──────────────────────────────────────── */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    projectId: varchar('project_id', { length: 30 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    createdBy: varchar('created_by', { length: 30 })
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    // SHA-256 of the plaintext key — we never store the plaintext after creation.
    hash: text('hash').notNull(),
    // Last 4 chars of the plaintext — safe to show in the dashboard as a hint.
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

/* ─── deployments ─────────────────────────────────────────────────── */
export const deploymentStatus = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type DeploymentStatus = (typeof deploymentStatus)[number];

export const deployments = pgTable(
  'deployments',
  {
    id: id(),
    projectId: varchar('project_id', { length: 30 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    triggeredBy: varchar('triggered_by', { length: 30 }).references(() => users.id),
    apiKeyId: varchar('api_key_id', { length: 30 }).references(() => apiKeys.id),
    status: text('status').$type<DeploymentStatus>().notNull().default('pending'),
    schemaDiffSummary: jsonb('schema_diff_summary'),
    // Full schema definition as declared by the user at deploy time. Every
    // deployment is a self-contained snapshot so rollbacks and diffs don't
    // depend on reconstructing from a chain of migrations.
    schemaSnapshot: jsonb('schema_snapshot'),
    functionCount: varchar('function_count', { length: 12 }),
    functionNames: jsonb('function_names'),
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

/* ─── audit_logs ──────────────────────────────────────────────────── */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorId: varchar('actor_id', { length: 30 }).references(() => users.id),
    projectId: varchar('project_id', { length: 30 }).references(() => projects.id),
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
export type NewAuditLog = typeof auditLogs.$inferInsert;
