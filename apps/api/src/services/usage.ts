import { and, eq, gte, lt, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { dataPlaneClient, schemaNameFor } from '../db/data-plane.js';
import { functionLogs, usageEvents } from '../db/schema.js';
import { log } from '../lib/logger.js';

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

export interface StorageUsage {
  /**
   * Total bytes on disk for every relation in the project's schema —
   * sums table data + indexes + toast via pg_total_relation_size.
   * Excludes the platform's _briven_* tables so the customer's usage
   * isn't inflated by our bookkeeping.
   */
  readonly bytes: number;
  /** Number of user tables (excludes _briven_*). */
  readonly tableCount: number;
  /** Echoed back so callers know which schema was measured. */
  readonly schema: string;
  /** Timestamp at which the size was sampled. */
  readonly sampledAt: string;
}

export interface ConnectionSecondsUsage {
  /**
   * Sum of realtime connection-seconds across the period. Source is
   * `usage_events` rows (metric='connection_seconds') populated hourly
   * by the aggregator's /metrics scrape — durable across api/realtime
   * restarts, unlike the in-memory `briven_realtime_connection_seconds_total`
   * gauge.
   */
  readonly seconds: number;
  readonly periodStart: string;
  readonly periodEnd: string;
}

/**
 * Sum connection_seconds rows in [periodStart, periodEnd) for one project.
 * Returns 0 when the aggregator hasn't yet written a row — the dashboard
 * renders that as "—" naturally.
 */
export async function getConnectionSecondsUsage(
  projectId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<ConnectionSecondsUsage> {
  if (periodEnd <= periodStart) {
    throw new Error('periodEnd must be after periodStart');
  }
  const db = getDb();
  const [row] = await db
    .select({
      seconds: sql<number>`coalesce(sum(${usageEvents.value}::bigint), 0)::bigint`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.projectId, projectId),
        eq(usageEvents.metric, 'connection_seconds'),
        gte(usageEvents.periodStart, periodStart),
        lt(usageEvents.periodStart, periodEnd),
      ),
    );
  // drizzle returns bigint as string in some setups — coerce to number.
  const raw = row?.seconds;
  const seconds = typeof raw === 'string' ? Number.parseInt(raw, 10) : (raw ?? 0);
  return {
    seconds: Number.isFinite(seconds) ? seconds : 0,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  };
}

export async function getCurrentMonthConnectionSecondsUsage(
  projectId: string,
  now: Date = new Date(),
): Promise<ConnectionSecondsUsage> {
  const { periodStart, periodEnd } = currentMonthBounds(now);
  return getConnectionSecondsUsage(projectId, periodStart, periodEnd);
}

/**
 * Query the data-plane for the storage footprint of a project's schema.
 * Cheap — single round-trip with a pg_total_relation_size aggregate.
 * Used by the dashboard usage widget and (Phase 3 follow-up) by the
 * Polar metering push.
 *
 * Returns {bytes:0, tableCount:0} when the schema doesn't exist yet
 * (project was just created but no deploy has landed) instead of
 * throwing — the dashboard renders this as "—" naturally.
 */
export async function getStorageUsage(projectId: string): Promise<StorageUsage> {
  const schema = schemaNameFor(projectId);
  const sampledAt = new Date().toISOString();
  try {
    const sql = dataPlaneClient();
    const rows = await sql<
      { bytes: string; table_count: string }[]
    >`
      SELECT
        COALESCE(SUM(pg_total_relation_size(format('%I.%I', n.nspname, c.relname)::regclass)), 0)::bigint AS bytes,
        COUNT(*)::bigint AS table_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schema}
        AND c.relkind IN ('r', 'p')  -- ordinary + partitioned tables
        AND c.relname NOT LIKE '_briven_%'
    `;
    const row = rows[0];
    return {
      bytes: row ? Number.parseInt(row.bytes, 10) : 0,
      tableCount: row ? Number.parseInt(row.table_count, 10) : 0,
      schema,
      sampledAt,
    };
  } catch (err) {
    log.warn('storage_usage_query_failed', {
      projectId,
      schema,
      message: err instanceof Error ? err.message : String(err),
    });
    return { bytes: 0, tableCount: 0, schema, sampledAt };
  }
}
