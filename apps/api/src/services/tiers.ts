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
