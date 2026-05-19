import { brivenError } from '@briven/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { projects, type ProjectTier } from '../db/schema.js';

/**
 * Tier limits. Single source of truth for every hard cap enforced at
 * project-create or deploy time. Rate-limit middleware handles the
 * per-request floor separately (Phase 3 free tier: 60 invokes / 10s).
 */
export interface TierLimits {
  readonly projectsPerOrg: number;
  readonly functionsPerProject: number;
  /** Soft cap — surfaced in dashboard; no hard enforcement per month yet. */
  readonly invokesPerMonth: number;
  /**
   * Total bytes on disk for the project's schema (user tables + indexes
   * + toast, excluding `_briven_*` bookkeeping). Soft cap — surfaced in
   * the dashboard usage widget; deploy-time enforcement is a Phase 3
   * follow-up that lands once the Polar metering push goes live.
   */
  readonly storageBytes: number;
  /**
   * Sum of realtime WebSocket connection-seconds across the calendar
   * month. Sampled hourly from the realtime /metrics gauge and pushed
   * to Polar's connection_seconds meter for overage billing. Soft cap
   * — surfaced on the dashboard usage widget; per-request rate limits
   * (RATE_LIMITS_BY_TIER) already throttle the connect path.
   */
  readonly connectionSecondsPerMonth: number;
  /**
   * Maximum concurrent subscriptions a single project can have open
   * across all of its WebSocket connections. Hard cap, enforced at
   * subscribe time by the realtime service. Stops one bad project
   * from exhausting the year-one 10,000 concurrent-subs target.
   */
  readonly concurrentSubscriptions: number;
  /**
   * Monthly active users for briven auth — distinct end-user accounts
   * with at least one session created in the trailing 30 days. Soft cap
   * for v1: surfaced in the auth → usage panel; overage feeds the Polar
   * `briven_auth_mau` meter once Polar is live (BUILD_PLAN.md §9). Free
   * + pro placeholders per "Decisions locked" Q5; team is the locked
   * 250k figure.
   */
  readonly authMauPerMonth: number;
}

export const TIERS: Record<ProjectTier, TierLimits> = {
  free: {
    projectsPerOrg: 3,
    functionsPerProject: 20,
    invokesPerMonth: 100_000,
    storageBytes: 1_073_741_824, // 1 GiB
    connectionSecondsPerMonth: 1_000_000, // ~12 days of one continuous connection
    concurrentSubscriptions: 100,
    authMauPerMonth: 1_000, // placeholder per BUILD_PLAN.md "Decisions locked" Q5
  },
  pro: {
    projectsPerOrg: 20,
    functionsPerProject: 200,
    invokesPerMonth: 1_000_000,
    storageBytes: 10_737_418_240, // 10 GiB
    connectionSecondsPerMonth: 10_000_000, // ~115 days = roughly 4 always-on subs
    concurrentSubscriptions: 1_000,
    authMauPerMonth: 25_000, // placeholder per BUILD_PLAN.md "Decisions locked" Q5
  },
  team: {
    projectsPerOrg: 100,
    functionsPerProject: 2_000,
    invokesPerMonth: 10_000_000,
    storageBytes: 107_374_182_400, // 100 GiB
    connectionSecondsPerMonth: 100_000_000, // ~1158 days = roughly 38 always-on
    concurrentSubscriptions: 10_000,
    authMauPerMonth: 250_000, // locked: BUILD_PLAN.md "Decisions locked" Q5
  },
};

/**
 * Per-request rate-limit ceilings, by scope and tier. The values are the
 * burst allowance over a 60-second sliding window — the rate-limit
 * middleware (`middleware/rate-limit.ts`) enforces these on every
 * request. The monthly `invokesPerMonth` softs above are separate;
 * those are reported in the dashboard but not hard-enforced today.
 *
 * Free-tier numbers are sized so a developer doing local dogfood work
 * never hits them, but a leaked key can't be turned into a load
 * generator. Pro is 10× free, Team is 100× free — same pattern as the
 * structural caps above.
 */
export type RateLimitScope = 'invoke' | 'deploy' | 'mutate';

/**
 * `mutate` is the catch-all scope for state-changing project routes that
 * aren't already covered by `invoke` or `deploy` — env writes, member
 * mutations, invitation create/revoke. Numbers are tighter than `invoke`
 * because these are admin-tier human ops, not hot-path RPCs.
 */
export const RATE_LIMITS_BY_TIER: Record<RateLimitScope, Record<ProjectTier, number>> = {
  invoke: { free: 60, pro: 600, team: 6_000 },
  deploy: { free: 5, pro: 30, team: 100 },
  mutate: { free: 30, pro: 300, team: 3_000 },
};

export const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Resolve a project's tier from the (denormalised) `projects.tier` column.
 * Falls back to 'free' if the project doesn't exist — callers (e.g.
 * rate-limit middleware) pass `null` through so an unknown project ID
 * doesn't amplify into a DoS vector via a tight DB-lookup loop.
 *
 * In-process cache with a 60-second TTL. Every invoke / deploy / mutate
 * route hits this on the rate-limit path, so a tight per-request DB
 * lookup is a meaningful cost at moderate scale; tier changes via
 * Polar webhook are rare (~hourly at peak) and a 60s staleness window
 * is well inside the wider rate-limit window. Cache is cleared by
 * `invalidateTierCache(projectId)` from the Polar webhook handler so a
 * paid upgrade takes effect within seconds, not after the TTL.
 */
interface CacheEntry {
  tier: ProjectTier | null;
  expiresAt: number;
}
const TIER_CACHE_TTL_MS = 60_000;
const tierCache = new Map<string, CacheEntry>();

export async function getProjectTier(projectId: string): Promise<ProjectTier | null> {
  const now = Date.now();
  const hit = tierCache.get(projectId);
  if (hit && hit.expiresAt > now) {
    return hit.tier;
  }
  const db = getDb();
  const [row] = await db
    .select({ tier: projects.tier, deletedAt: projects.deletedAt })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const tier = !row || row.deletedAt ? null : row.tier;
  tierCache.set(projectId, { tier, expiresAt: now + TIER_CACHE_TTL_MS });
  return tier;
}

/**
 * Drop the cached tier for a project. Called from the Polar webhook
 * handler after a successful subscription upsert so the new tier
 * takes effect on the very next request, not after the TTL.
 */
export function invalidateTierCache(projectId: string): void {
  tierCache.delete(projectId);
}

/**
 * Per-request rate-limit cap for a scope on a given project. Returns
 * `null` if the project can't be resolved — the middleware treats null
 * as "skip rate limiting" so we don't leak existence vs. non-existence
 * via response timing.
 */
export async function resolveProjectRateLimit(
  projectId: string,
  scope: RateLimitScope,
): Promise<number | null> {
  const tier = await getProjectTier(projectId).catch(() => null);
  if (!tier) return null;
  return RATE_LIMITS_BY_TIER[scope][tier];
}

export class TierLimitExceeded extends brivenError {
  constructor(reason: string, context: Record<string, unknown>) {
    super('tier_limit_exceeded', reason, { status: 402, context });
    this.name = 'TierLimitExceeded';
  }
}

/**
 * Count a user's non-deleted projects. Called by services/projects.ts
 * before inserting a new row.
 */
export async function assertProjectCreateAllowed(
  orgId: string,
  orgTier: ProjectTier = 'free',
): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), isNull(projects.deletedAt)));
  const count = row?.count ?? 0;
  const limit = TIERS[orgTier].projectsPerOrg;
  if (count >= limit) {
    throw new TierLimitExceeded(`project limit reached for tier '${orgTier}' (${count}/${limit})`, {
      orgId,
      tier: orgTier,
      count,
      limit,
    });
  }
}

/**
 * Cap the number of functions a deployment can ship. Called by the deploy
 * route before handing off to schema-apply.
 */
export function assertFunctionCountAllowed(functionCount: number, tier: ProjectTier): void {
  const limit = TIERS[tier].functionsPerProject;
  if (functionCount > limit) {
    throw new TierLimitExceeded(
      `deployment has ${functionCount} functions, tier '${tier}' caps at ${limit}`,
      { functionCount, tier, limit },
    );
  }
}
