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
}

export const TIERS: Record<ProjectTier, TierLimits> = {
  free: { projectsPerOrg: 3, functionsPerProject: 20, invokesPerMonth: 100_000 },
  pro: { projectsPerOrg: 20, functionsPerProject: 200, invokesPerMonth: 1_000_000 },
  team: { projectsPerOrg: 100, functionsPerProject: 2_000, invokesPerMonth: 10_000_000 },
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
 */
export async function getProjectTier(projectId: string): Promise<ProjectTier | null> {
  const db = getDb();
  const [row] = await db
    .select({ tier: projects.tier, deletedAt: projects.deletedAt })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!row || row.deletedAt) return null;
  return row.tier;
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
