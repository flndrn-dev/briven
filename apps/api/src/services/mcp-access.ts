import { createHash, randomBytes } from 'node:crypto';

import { newId, NotFoundError } from '@briven/shared';

import { and, desc, eq, inArray, isNull, like } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  mcpKeys,
  platformSettings,
  projects,
  subscriptions,
  type McpKey,
  type McpKeyScope,
  type NewMcpKey,
  type ProjectTier,
} from '../db/schema.js';
import { audit, listAuditByActionPrefix, type AuditEntry, type AuditRow } from './audit.js';
import { getPlatformSetting, setPlatformSetting } from './platform-settings.js';

/**
 * B Phase 5 — MCP / Agent-Access control surface.
 *
 * This is the on/off + key-issuing + audit SURFACE for the future MCP server.
 * It does NOT speak the MCP wire protocol — the socket server that consumes
 * these keys is a separate track. What lives here:
 *   - a GLOBAL kill-switch (platform_settings `mcp.enabled`) that gates every
 *     agent's access at once;
 *   - per-project enablement (platform_settings `mcp.project.<id>`), behind a
 *     SERVER-SIDE plan gate — only paying Pro/Team projects qualify;
 *   - per-key issue (one-time plaintext reveal, sha-256 hash stored) + revoke;
 *   - the mcp.* audit trail, written through the shared audit() helper into the
 *     existing audit_logs table (no second audit table).
 *
 * Nothing security-sensitive is cached: the global flag read goes through
 * platform-settings' short TTL cache (a flag flip, not a secret), but key
 * lookups and the plan gate always hit the DB fresh.
 */

/* ─── constants ──────────────────────────────────────────────────────────── */

/** Platform-settings key for the global MCP kill-switch. */
export const MCP_GLOBAL_FLAG = 'mcp.enabled';
/** Plaintext prefix for issued keys — recognisable in logs + grep. */
export const MCP_KEY_PREFIX = 'pk_briven_mcp_';
const KEY_ENTROPY_BYTES = 32; // 256 bits
/** Tiers that may turn on MCP access. Free never qualifies. */
export const MCP_PAID_TIERS = ['pro', 'team'] as const satisfies readonly ProjectTier[];

/** Per-project platform-settings key. */
function projectFlagKey(projectId: string): string {
  return `mcp.project.${projectId}`;
}

/* ─── typed errors ───────────────────────────────────────────────────────── */

/**
 * Thrown when MCP enable / key-issue is attempted for a project that is NOT on
 * a paying plan. The route maps this to a 4xx so a direct API call can't slip
 * past the UI gate.
 */
export class McpPlanRequiredError extends Error {
  readonly code = 'mcp_plan_required' as const;
  constructor(
    readonly projectId: string,
    readonly tier: ProjectTier | null,
  ) {
    super('MCP access requires a Pro or Team plan');
    this.name = 'McpPlanRequiredError';
  }
}

/* ─── pure helpers (unit-testable without a DB) ──────────────────────────── */

/** The plan gate, as a pure rule: only Pro / Team qualify. */
export function isPlanEligibleForMcp(tier: ProjectTier | null | undefined): boolean {
  return tier === 'pro' || tier === 'team';
}

/**
 * Generate a fresh MCP key. The plaintext is returned to the caller exactly
 * once; only the sha-256 hash is ever persisted. Mirrors api-keys.ts.
 */
export function generateMcpKey(): {
  plaintext: string;
  hash: string;
  prefix: string;
  suffix: string;
} {
  const raw = randomBytes(KEY_ENTROPY_BYTES).toString('base64url');
  const plaintext = `${MCP_KEY_PREFIX}${raw}`;
  const hash = createHash('sha256').update(plaintext).digest('hex');
  const suffix = plaintext.slice(-4);
  return { plaintext, hash, prefix: MCP_KEY_PREFIX, suffix };
}

export interface MaskedMcpKey {
  id: string;
  name: string;
  prefix: string;
  suffix: string;
  scope: McpKeyScope;
  enabled: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/** Strip the hash; never return it. The dashboard only ever sees prefix…suffix. */
export function maskKey(row: McpKey): MaskedMcpKey {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    suffix: row.suffix,
    scope: row.scope,
    enabled: row.enabled,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

/* ─── injectable seam (so the mutators are unit-testable without a DB) ────── */

/** The actor behind a state change — threaded into the audit row. */
export interface McpActor {
  id: string | null;
  ipHash: string | null;
  userAgent: string | null;
}

export interface McpAccessDeps {
  /** Persist the global kill-switch flag. */
  setGlobalSetting(on: boolean, actorId: string | null): Promise<void>;
  /**
   * Effective paid plan tier for a project, from the SAME source Phase 3 used
   * (the org's non-canceled subscriptions table). Returns null when the
   * project does not exist / is deleted; 'free' when no paid subscription.
   */
  getProjectPlanTier(projectId: string): Promise<ProjectTier | null>;
  /** Persist per-project enablement. */
  setProjectEnabled(projectId: string, on: boolean, actorId: string | null): Promise<void>;
  insertKey(row: NewMcpKey): Promise<McpKey>;
  getKeyById(keyId: string): Promise<McpKey | null>;
  /** Set revoked_at = now() AND enabled = false. */
  setKeyRevoked(keyId: string): Promise<void>;
  audit(entry: AuditEntry): Promise<void>;
}

/** Real, DB-backed dependencies. */
export const defaultMcpAccessDeps: McpAccessDeps = {
  async setGlobalSetting(on, actorId) {
    await setPlatformSetting(MCP_GLOBAL_FLAG, on, actorId);
  },
  async getProjectPlanTier(projectId) {
    const db = getDb();
    const [proj] = await db
      .select({ orgId: projects.orgId, deletedAt: projects.deletedAt })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!proj || proj.deletedAt) return null;
    const [sub] = await db
      .select({ tier: subscriptions.tier, status: subscriptions.status })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.orgId, proj.orgId),
          inArray(subscriptions.status, ['trialing', 'active', 'past_due']),
        ),
      )
      .limit(1);
    if (sub && (sub.tier === 'pro' || sub.tier === 'team')) return sub.tier;
    return 'free';
  },
  async setProjectEnabled(projectId, on, actorId) {
    await setPlatformSetting(projectFlagKey(projectId), on, actorId);
  },
  async insertKey(row) {
    const db = getDb();
    const [record] = await db.insert(mcpKeys).values(row).returning();
    if (!record) throw new Error('mcp key insert returned no row');
    return record;
  },
  async getKeyById(keyId) {
    const db = getDb();
    const [row] = await db.select().from(mcpKeys).where(eq(mcpKeys.id, keyId)).limit(1);
    return row ?? null;
  },
  async setKeyRevoked(keyId) {
    const db = getDb();
    await db
      .update(mcpKeys)
      .set({ revokedAt: new Date(), enabled: false })
      .where(eq(mcpKeys.id, keyId));
  },
  async audit(entry) {
    await audit(entry);
  },
};

/* ─── global kill-switch ─────────────────────────────────────────────────── */

/** Read the global MCP on/off flag (defaults OFF). */
export async function getGlobalEnabled(): Promise<boolean> {
  const value = await getPlatformSetting<unknown>(MCP_GLOBAL_FLAG, false);
  return value === true;
}

/** Flip the global MCP kill-switch + audit it. */
export async function setGlobalEnabled(
  on: boolean,
  actor: McpActor,
  deps: McpAccessDeps = defaultMcpAccessDeps,
): Promise<{ enabled: boolean }> {
  await deps.setGlobalSetting(on, actor.id);
  await deps.audit({
    actorId: actor.id,
    projectId: null,
    action: 'mcp.global.toggle',
    ipHash: actor.ipHash,
    userAgent: actor.userAgent,
    metadata: { enabled: on },
  });
  return { enabled: on };
}

/* ─── per-project enablement (server-side plan gate) ─────────────────────── */

/**
 * Turn MCP access ON for a project. SERVER-SIDE plan gate: a free-tier (or
 * unknown) project is rejected with McpPlanRequiredError even when called
 * directly, so the UI hiding the button is defence-in-depth, not the gate.
 */
export async function enableForProject(
  projectId: string,
  actor: McpActor,
  deps: McpAccessDeps = defaultMcpAccessDeps,
): Promise<{ projectId: string; enabled: true }> {
  const tier = await deps.getProjectPlanTier(projectId);
  if (!isPlanEligibleForMcp(tier)) {
    throw new McpPlanRequiredError(projectId, tier);
  }
  await deps.setProjectEnabled(projectId, true, actor.id);
  await deps.audit({
    actorId: actor.id,
    projectId,
    action: 'mcp.project.enable',
    ipHash: actor.ipHash,
    userAgent: actor.userAgent,
    metadata: { projectId, tier },
  });
  return { projectId, enabled: true };
}

/** Turn MCP access OFF for a project (no plan gate — disabling is always allowed). */
export async function disableForProject(
  projectId: string,
  actor: McpActor,
  deps: McpAccessDeps = defaultMcpAccessDeps,
): Promise<{ projectId: string; enabled: false }> {
  await deps.setProjectEnabled(projectId, false, actor.id);
  await deps.audit({
    actorId: actor.id,
    projectId,
    action: 'mcp.project.disable',
    ipHash: actor.ipHash,
    userAgent: actor.userAgent,
    metadata: { projectId },
  });
  return { projectId, enabled: false };
}

/* ─── key issue / revoke ─────────────────────────────────────────────────── */

export interface IssuedMcpKey {
  key: MaskedMcpKey;
  /** Full plaintext — returned EXACTLY once, never stored, never returned again. */
  plaintext: string;
}

/**
 * Issue a new MCP key for a project. Re-checks the plan gate (defence in
 * depth — a key must never exist for a non-paying project) before generating.
 * The plaintext is returned once; only the hash is persisted.
 */
export async function issueKey(
  input: { projectId: string; name: string; scope: McpKeyScope },
  actor: McpActor,
  deps: McpAccessDeps = defaultMcpAccessDeps,
): Promise<IssuedMcpKey> {
  const tier = await deps.getProjectPlanTier(input.projectId);
  if (!isPlanEligibleForMcp(tier)) {
    throw new McpPlanRequiredError(input.projectId, tier);
  }
  if (!actor.id) throw new Error('issueKey requires an actor id (created_by)');

  const { plaintext, hash, prefix, suffix } = generateMcpKey();
  const record = await deps.insertKey({
    id: newId('mck'),
    projectId: input.projectId,
    name: input.name,
    hash,
    prefix,
    suffix,
    scope: input.scope,
    enabled: true,
    createdBy: actor.id,
  });
  await deps.audit({
    actorId: actor.id,
    projectId: input.projectId,
    action: 'mcp.key.issue',
    ipHash: actor.ipHash,
    userAgent: actor.userAgent,
    metadata: { projectId: input.projectId, keyId: record.id, scope: input.scope, suffix },
  });
  return { key: maskKey(record), plaintext };
}

/** Revoke a key: stamps revoked_at + flips enabled false. Idempotent-safe. */
export async function revokeKey(
  keyId: string,
  actor: McpActor,
  deps: McpAccessDeps = defaultMcpAccessDeps,
): Promise<{ keyId: string; revoked: true }> {
  const row = await deps.getKeyById(keyId);
  if (!row) throw new NotFoundError('mcp_key', keyId);
  if (!row.revokedAt) {
    await deps.setKeyRevoked(keyId);
  }
  await deps.audit({
    actorId: actor.id,
    projectId: row.projectId,
    action: 'mcp.key.revoke',
    ipHash: actor.ipHash,
    userAgent: actor.userAgent,
    metadata: { projectId: row.projectId, keyId },
  });
  return { keyId, revoked: true };
}

/* ─── read surfaces (cockpit) ────────────────────────────────────────────── */

export interface ProjectAccessRow {
  projectId: string;
  projectName: string;
  /** Effective paid tier (free | pro | team) — drives the UI enable gate. */
  planTier: ProjectTier;
  /** Whether MCP is currently enabled for this project. */
  mcpEnabled: boolean;
  /** Whether the plan qualifies (Pro/Team) — the UI offers "enable" only when true. */
  eligible: boolean;
  keys: MaskedMcpKey[];
}

/**
 * Every non-deleted project with its effective plan tier, MCP-enabled flag, and
 * issued keys (masked). One payload the cockpit renders the whole per-project
 * list from: enabled projects show keys + disable; paying-but-not-enabled show
 * an enable button; free-tier show a muted "requires Pro/Team" note.
 */
export async function listProjectAccess(limit = 500): Promise<ProjectAccessRow[]> {
  const db = getDb();

  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      orgId: projects.orgId,
    })
    .from(projects)
    .where(isNull(projects.deletedAt))
    .orderBy(desc(projects.createdAt))
    .limit(limit);
  if (projectRows.length === 0) return [];

  const orgIds = [...new Set(projectRows.map((p) => p.orgId))];
  const projectIds = projectRows.map((p) => p.id);

  // Paid tiers come from the SAME source Phase 3 used: the org's non-canceled
  // subscriptions. A project with no paid subscription is 'free'.
  const subs = await db
    .select({ orgId: subscriptions.orgId, tier: subscriptions.tier })
    .from(subscriptions)
    .where(
      and(
        inArray(subscriptions.orgId, orgIds),
        inArray(subscriptions.status, ['trialing', 'active', 'past_due']),
      ),
    );
  const tierByOrg = new Map<string, ProjectTier>();
  for (const s of subs) {
    if (s.tier === 'pro' || s.tier === 'team') tierByOrg.set(s.orgId, s.tier);
  }

  // Per-project enablement lives in platform_settings under mcp.project.<id>.
  const flagRows = await db
    .select({ key: platformSettings.key, value: platformSettings.value })
    .from(platformSettings)
    .where(like(platformSettings.key, 'mcp.project.%'));
  const enabledByProject = new Set<string>();
  for (const r of flagRows) {
    if (r.value === true) enabledByProject.add(r.key.slice('mcp.project.'.length));
  }

  const keyRows = await db
    .select()
    .from(mcpKeys)
    .where(inArray(mcpKeys.projectId, projectIds))
    .orderBy(desc(mcpKeys.createdAt));
  const keysByProject = new Map<string, MaskedMcpKey[]>();
  for (const k of keyRows) {
    const list = keysByProject.get(k.projectId) ?? [];
    list.push(maskKey(k));
    keysByProject.set(k.projectId, list);
  }

  return projectRows.map((p) => {
    const planTier = tierByOrg.get(p.orgId) ?? 'free';
    return {
      projectId: p.id,
      projectName: p.name,
      planTier,
      mcpEnabled: enabledByProject.has(p.id),
      eligible: isPlanEligibleForMcp(planTier),
      keys: keysByProject.get(p.id) ?? [],
    };
  });
}

/** Recent mcp.* audit rows for the cockpit audit-trail table. */
export async function listMcpAudit(limit = 200): Promise<AuditRow[]> {
  return listAuditByActionPrefix('mcp.', limit);
}

/* ─── key verification (the live MCP-server auth gate) ───────────────────── */

/**
 * Hash a presented plaintext key EXACTLY the way `generateMcpKey()` does, so a
 * lookup by hash finds the row issued for that plaintext. sha-256 hex of the
 * full plaintext (prefix included). Kept as its own helper so the hashing rule
 * lives in one place and the verifier can never drift from the issuer.
 */
export function hashMcpKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/** Why a presented key was refused. 401 = auth (bad key); 403 = gate (plan/switch). */
export type McpVerifyFailure =
  | 'missing_key'
  | 'malformed_key'
  | 'unknown_key'
  | 'revoked_key'
  | 'global_disabled'
  | 'project_disabled'
  | 'plan_ineligible';

/**
 * Result of verifying a presented MCP key. On success it carries the ONLY
 * facts the MCP server is allowed to trust: which key, which project it is
 * hard-locked to, and what it may do. There is deliberately no way for a
 * caller to widen `projectId` — it comes from the stored row, never the wire.
 */
export type McpVerifyResult =
  | { ok: true; keyId: string; projectId: string; scope: McpKeyScope }
  | { ok: false; status: 401 | 403; reason: McpVerifyFailure };

/** Injectable seam so the verifier is unit-testable without a live DB. */
export interface McpVerifyDeps {
  getKeyByHash(hash: string): Promise<McpKey | null>;
  touchKeyLastUsed(keyId: string): Promise<void>;
  isGlobalEnabled(): Promise<boolean>;
  isProjectEnabled(projectId: string): Promise<boolean>;
  getProjectPlanTier(projectId: string): Promise<ProjectTier | null>;
}

/** Real, DB-backed verification dependencies. */
export const defaultMcpVerifyDeps: McpVerifyDeps = {
  async getKeyByHash(hash) {
    const db = getDb();
    const [row] = await db.select().from(mcpKeys).where(eq(mcpKeys.hash, hash)).limit(1);
    return row ?? null;
  },
  async touchKeyLastUsed(keyId) {
    const db = getDb();
    await db.update(mcpKeys).set({ lastUsedAt: new Date() }).where(eq(mcpKeys.id, keyId));
  },
  isGlobalEnabled() {
    return getGlobalEnabled();
  },
  async isProjectEnabled(projectId) {
    const value = await getPlatformSetting<unknown>(projectFlagKey(projectId), false);
    return value === true;
  },
  getProjectPlanTier(projectId) {
    return defaultMcpAccessDeps.getProjectPlanTier(projectId);
  },
};

/**
 * Verify a presented plaintext key and resolve its project binding + scope.
 *
 * Order matters — auth first (is this a real, live key?), then the gates (is
 * MCP even on for this project, and does the plan still qualify?):
 *   1. present + well-formed prefix          → else 401 missing/malformed
 *   2. hash matches a stored row             → else 401 unknown
 *   3. not revoked and still enabled         → else 401 revoked
 *   4. global kill-switch is ON              → else 403 global_disabled
 *   5. project is enabled for MCP            → else 403 project_disabled
 *   6. project's plan is Pro/Team            → else 403 plan_ineligible
 *
 * The plaintext key is NEVER logged or returned. On success `lastUsedAt` is
 * stamped. The caller binds the returned `projectId`/`scope` to the request —
 * no tool ever sees a project id from the wire.
 */
export async function verifyMcpKey(
  presented: string | null | undefined,
  deps: McpVerifyDeps = defaultMcpVerifyDeps,
): Promise<McpVerifyResult> {
  if (!presented) return { ok: false, status: 401, reason: 'missing_key' };
  if (!presented.startsWith(MCP_KEY_PREFIX)) {
    return { ok: false, status: 401, reason: 'malformed_key' };
  }
  const row = await deps.getKeyByHash(hashMcpKey(presented));
  if (!row) return { ok: false, status: 401, reason: 'unknown_key' };
  if (row.revokedAt || !row.enabled) return { ok: false, status: 401, reason: 'revoked_key' };

  if (!(await deps.isGlobalEnabled())) {
    return { ok: false, status: 403, reason: 'global_disabled' };
  }
  if (!(await deps.isProjectEnabled(row.projectId))) {
    return { ok: false, status: 403, reason: 'project_disabled' };
  }
  const tier = await deps.getProjectPlanTier(row.projectId);
  if (!isPlanEligibleForMcp(tier)) {
    return { ok: false, status: 403, reason: 'plan_ineligible' };
  }

  await deps.touchKeyLastUsed(row.id);
  return { ok: true, keyId: row.id, projectId: row.projectId, scope: row.scope };
}
