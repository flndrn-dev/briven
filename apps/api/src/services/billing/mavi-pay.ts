/**
 * Mavi Pay (currently backed by Polar.sh) — Phase 3 wires real MRR/churn here;
 * only this file changes.
 *
 * The superadmin Overview's "business row" reads from this seam. Today we
 * return only what the control-plane DB can honestly prove:
 *
 *   - planMix    : a live COUNT of non-deleted projects grouped by tier.
 *   - subscribers: count of non-deleted projects on a PAID tier (pro + team).
 *                  Definition is intentionally "paid projects", not "paying
 *                  users" — a user can own several projects, and the payment
 *                  processor (not the control DB) is the source of truth for
 *                  who is actually invoiced. We surface the honest derivable
 *                  number and label it as "paid projects" in the UI.
 *   - mrr        : null — requires the payment processor's invoice totals.
 *   - churn30d   : null — requires the processor's cancellation events.
 *
 * Anything we can't prove returns null so the UI shows "—" with a
 * "Mavi Pay wiring up" note rather than a fake zero.
 */
import { isNull, sql } from 'drizzle-orm';

import { getDb } from '../../db/client.js';
import { projects, projectTier, type ProjectTier } from '../../db/schema.js';

export type PlanMix = Record<ProjectTier, number>;

export interface BillingTotals {
  /** Count of non-deleted projects on a paid tier (pro + team). */
  subscribers: number | null;
  /** Monthly recurring revenue — null until the processor is wired (Phase 3). */
  mrr: number | null;
  /** Non-deleted project count grouped by tier. */
  planMix: PlanMix | null;
  /** 30-day churn — null until the processor is wired (Phase 3). */
  churn30d: number | null;
}

/**
 * Pure helper: paid subscribers are everything that isn't on the free
 * tier. Kept separate from the DB query so the rule is unit-testable
 * without a database. A change here without its test shows up red.
 */
export function paidSubscribers(planMix: PlanMix): number {
  return planMix.pro + planMix.team;
}

export async function getBillingTotals(): Promise<BillingTotals> {
  const db = getDb();
  const rows = await db
    .select({ tier: projects.tier, count: sql<number>`count(*)::int` })
    .from(projects)
    .where(isNull(projects.deletedAt))
    .groupBy(projects.tier);

  // Seed every known tier at 0 so a tier with no projects still reports a
  // real 0 (an absence of paid projects IS a known fact), then layer the
  // actual counts on top.
  const planMix = Object.fromEntries(projectTier.map((t) => [t, 0])) as PlanMix;
  for (const row of rows) {
    if (row.tier in planMix) planMix[row.tier] = row.count;
  }

  return {
    subscribers: paidSubscribers(planMix),
    planMix,
    // Processor-backed numbers — Phase 3 fills these from Polar.sh.
    mrr: null,
    churn30d: null,
  };
}
