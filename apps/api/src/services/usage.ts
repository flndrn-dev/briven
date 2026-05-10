import { and, eq, gte, lt, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { functionLogs } from '../db/schema.js';

/**
 * Phase 3 usage metering — invocations slice.
 *
 * Reads the meta-DB's `function_logs` table (where `apps/api/src/workers/
 * log-fanout.ts` durably persists every invocation envelope from the
 * runtime). Aggregates `count` and `totalDurationMs` for billing /
 * dashboard surfaces.
 *
 * Caveat: `function_logs` is pruned to 7 days on free tier (see
 * `pruneOldFunctionLogs` in `workers/log-fanout.ts`). Querying outside
 * the retention window returns under-counted data. Resolving this needs
 * either tier-aware retention extension, or a periodic `usage_rollups`
 * snapshot landed before pruning runs — both deferred follow-ups.
 */

export interface InvocationUsage {
  /** Total successful + errored invocations in the window. */
  readonly count: number;
  /**
   * Sum of `durationMs` across all invocations in the window. Stored as
   * varchar in `function_logs`; cast to int in SQL. Caps at 2^31-1 ms
   * (~24 days of cumulative compute) — beyond that, swap to bigint.
   */
  readonly totalDurationMs: number;
  /** Echoed back so callers can verify the period they asked for. */
  readonly periodStart: string;
  readonly periodEnd: string;
}

export async function getInvocationUsage(
  projectId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<InvocationUsage> {
  if (periodEnd <= periodStart) {
    throw new Error('periodEnd must be after periodStart');
  }
  const db = getDb();
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      totalDurationMs: sql<number>`coalesce(sum(${functionLogs.durationMs}::int), 0)::int`,
    })
    .from(functionLogs)
    .where(
      and(
        eq(functionLogs.projectId, projectId),
        gte(functionLogs.createdAt, periodStart),
        lt(functionLogs.createdAt, periodEnd),
      ),
    );
  return {
    count: row?.count ?? 0,
    totalDurationMs: row?.totalDurationMs ?? 0,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  };
}

/**
 * UTC calendar-month boundaries for a given reference date. Used by the
 * dashboard "this month so far" widget — invocation counts compare to
 * `TIERS[tier].invokesPerMonth`. The boundary is the first millisecond
 * of the next month, not the last of the current — `[start, end)`
 * matches the SQL `gte` + `lt` aggregation contract above.
 */
export function currentMonthBounds(now: Date = new Date()): {
  periodStart: Date;
  periodEnd: Date;
} {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const periodEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  return { periodStart, periodEnd };
}

export async function getCurrentMonthInvocationUsage(
  projectId: string,
  now: Date = new Date(),
): Promise<InvocationUsage> {
  const { periodStart, periodEnd } = currentMonthBounds(now);
  return getInvocationUsage(projectId, periodStart, periodEnd);
}
