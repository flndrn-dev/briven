import { runInProjectDatabase } from '../db/data-plane.js';

import { getProjectTier, TIERS } from './tiers.js';
import { currentMonthBounds } from './usage.js';

/**
 * ── THE SINGLE CANONICAL MAU WINDOW ──────────────────────────────────
 * Briven auth MAU = distinct end-user accounts in a project that have at
 * least one session created in the CURRENT UTC CALENDAR MONTH
 * ([first-of-month 00:00:00 UTC, now]).
 *
 * Why calendar month, not a trailing 30-day window: billing invoices are
 * cut on calendar-month boundaries, so the metered quantity we push to
 * Polar MUST reset on the same boundary or overage would be charged
 * against the wrong invoice. `currentMauWindow()` below is the ONE
 * definition; the hourly aggregator (workers/usage-aggregator.ts) and the
 * Polar push (workers/polar-meter-push.ts) both agree on it via this
 * function + the shared `currentMonthBounds()` it delegates to.
 *
 * Read-time path: the dashboard hits this when the Auth → Usage page
 * loads, and the main usage route reads the durable monthly roll-up the
 * aggregator writes (services/usage.ts → getCurrentMonthAuthMau).
 */

export interface AuthMauStats {
  /** Distinct active users in the current UTC calendar month. */
  count: number;
  /** Plan ceiling for the current tier (`TIERS[tier].authMauPerMonth`). */
  ceiling: number;
  /** Tier as it currently stands in `projects.tier`. */
  tier: 'free' | 'pro' | 'team';
  /** Window start (first millisecond of the UTC month), ISO-8601. */
  windowStart: string;
  /** Window end (now), ISO-8601. */
  windowEnd: string;
  /** Fraction `count / ceiling`, clamped to [0, 2]. Soft-cap UI rendering. */
  usageFraction: number;
}

interface CountRow {
  count: number | string;
}

/**
 * The canonical MAU window for a reference instant: [start-of-UTC-month, now].
 * Exported so every producer/consumer of the MAU number (aggregator, push,
 * usage route, dashboard) shares one definition and can never drift apart.
 */
export function currentMauWindow(now: Date = new Date()): {
  windowStart: Date;
  windowEnd: Date;
} {
  return { windowStart: currentMonthBounds(now).periodStart, windowEnd: now };
}

export async function getAuthMauStats(projectId: string): Promise<AuthMauStats> {
  const tier = (await getProjectTier(projectId)) ?? 'free';
  const ceiling = TIERS[tier].authMauPerMonth;

  const { windowStart, windowEnd } = currentMauWindow();

  // Distinct user_id across sessions created this calendar month. We could
  // read users + last_seen but distinct-from-sessions is the spec'd
  // definition (an MAU is someone who *used* the app in the window).
  // `created_at` can't be in the future, so `>= windowStart` == the
  // [windowStart, now] window. Parameterised — never string-interpolated.
  const rows = await runInProjectDatabase<CountRow[]>(projectId, async (tx) => {
    return (await tx.unsafe(
      `SELECT COUNT(DISTINCT user_id)::bigint AS count
       FROM "_briven_auth_sessions"
       WHERE created_at >= $1`,
      [windowStart.toISOString()],
    )) as CountRow[];
  });

  // postgres.js returns BIGINT as string by default. Parse defensively in
  // case the driver config flips.
  const raw = rows[0]?.count ?? 0;
  const count = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  const usageFraction = ceiling > 0 ? Math.min(2, count / ceiling) : 0;

  return {
    count,
    ceiling,
    tier,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    usageFraction,
  };
}
