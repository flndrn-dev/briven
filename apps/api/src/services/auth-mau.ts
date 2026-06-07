import { runInProjectSchema } from '../db/data-plane.js';

import { getProjectTier, TIERS } from './tiers.js';

/**
 * Briven auth MAU = distinct end-user accounts in a project that have at
 * least one session created in the trailing 30 days. Pulled at read time
 * (the dashboard hits this endpoint when the Auth → Usage page loads) —
 * no background materialisation yet. Once Polar metering goes live the
 * authoritative push is a daily roll-up; this read-time path stays as
 * the "is my count right?" debug surface.
 */

export interface AuthMauStats {
  /** Distinct active users in the trailing 30 days. */
  count: number;
  /** Plan ceiling for the current tier (`TIERS[tier].authMauPerMonth`). */
  ceiling: number;
  /** Tier as it currently stands in `projects.tier`. */
  tier: 'free' | 'pro' | 'team';
  /** Window start (now - 30 days), ISO-8601. */
  windowStart: string;
  /** Window end (now), ISO-8601. */
  windowEnd: string;
  /** Fraction `count / ceiling`, clamped to [0, 2]. Soft-cap UI rendering. */
  usageFraction: number;
}

interface CountRow {
  count: number | string;
}

const WINDOW_DAYS = 30;

export async function getAuthMauStats(projectId: string): Promise<AuthMauStats> {
  const tier = (await getProjectTier(projectId)) ?? 'free';
  const ceiling = TIERS[tier].authMauPerMonth;

  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Distinct user_id across sessions in the window. We could read users +
  // last_seen but distinct-from-sessions is the spec'd definition (an MAU
  // is someone who *used* the app in the window).
  const [rows] = await runInProjectSchema<[CountRow[], unknown]>(projectId, async (conn) => {
    return (await conn.query(
      `SELECT COUNT(DISTINCT user_id) AS count
       FROM \`_briven_auth_sessions\`
       WHERE created_at > NOW() - INTERVAL ${WINDOW_DAYS} DAY`,
    )) as [CountRow[], unknown];
  });

  // mysql2 returns BIGINT as number by default. Parse defensively in
  // case the driver config flips.
  const raw = rows[0]?.count ?? 0;
  const count = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  const usageFraction = ceiling > 0 ? Math.min(2, count / ceiling) : 0;

  return {
    count,
    ceiling,
    tier,
    windowStart: windowStart.toISOString(),
    windowEnd: now.toISOString(),
    usageFraction,
  };
}
