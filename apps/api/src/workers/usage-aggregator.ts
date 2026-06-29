import { and, eq, isNull, sql as drizzleSql } from 'drizzle-orm';

import { newId } from '@briven/shared';

import { getDb } from '../db/client.js';
import { isGaugeMetric, projects, usageEvents, type UsageMetric } from '../db/schema.js';
import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { getAuthMauStats } from '../services/auth-mau.js';
import { collectConnectionSecondsDeltas } from '../services/connection-seconds.js';
import { isAuthEnabled } from '../services/tenant-config-store.js';
import { currentMonthBounds, getInvocationUsage, getStorageUsage } from '../services/usage.js';

type DbHandle = ReturnType<typeof getDb>;

/**
 * Hourly usage aggregator. For each non-deleted project:
 *   1. invocations — count + duration from function_logs for the hour
 *      window [period_start, period_start + 1h)
 *   2. storage_bytes — pg_total_relation_size sample at period_end
 *   3. connection_seconds — scrape briven_realtime_connection_seconds_total
 *      from realtime /metrics, compute delta vs previous period
 *
 * Storage rows are written per (project, BILLING-MONTH, metric) and auth
 * MAU likewise — see the gauge note below.
 *
 * COUNTERS vs GAUGES (the money-critical distinction — see schema.ts
 * `isGaugeMetric`):
 *   - COUNTERS (invocations, connection_seconds) are additive per hour, so
 *     one row per (project, HOUR, metric); Polar SUMs them across the month.
 *   - GAUGES (storage_bytes, auth_mau) are point-in-time levels. Writing a
 *     new row every hour would stack ~720 snapshots a month; a SUM meter
 *     would then bill ~720× the real value. So gauges are keyed by
 *     period_start = first-of-UTC-month and UPSERTed to the LATEST value —
 *     exactly ONE row per (project, month, gauge-metric). The Polar push
 *     bills the delta-to-latest so the running total equals the final value.
 *
 * Idempotent via the unique index (project_id, period_start, metric): a
 * counter re-run overwrites that hour's row; a gauge re-run overwrites the
 * single monthly row with the freshest snapshot — both safe for catch-up.
 *
 * Polar push is a separate worker (`polar-meter-push.ts`) that scans
 * WHERE polar_push_status='pending'. Until a meter id is configured the
 * rows are marked 'skipped' and the operator can verify the data via SQL.
 */

const HOUR_MS = 60 * 60 * 1000;

/** First millisecond of the UTC hour containing `now`. */
export function currentHourStart(now: Date = new Date()): Date {
  return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
}

/**
 * Roll up the hour that JUST ENDED. Called from the cron. We deliberately
 * lag by one full hour so the function_logs that landed at xx:59:59 are
 * always inside the [start, end) window we read.
 */
export async function aggregateUsageForCompletedHour(now: Date = new Date()): Promise<{
  hoursProcessed: number;
  rowsWritten: number;
}> {
  const periodEnd = currentHourStart(now);
  const periodStart = new Date(periodEnd.getTime() - HOUR_MS);

  const db = getDb();
  const activeProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(isNull(projects.deletedAt));

  // Scrape the realtime /metrics counter once for the whole batch — the
  // diff returned is the per-project delta since the previous hourly
  // scrape. Projects not in the map had no realtime activity this hour;
  // we don't write a zero row for them (saves index churn).
  const connectionSeconds = await collectConnectionSecondsDeltas();

  let rowsWritten = 0;
  for (const { id: projectId } of activeProjects) {
    try {
      const written = await rollUpProject(
        projectId,
        periodStart,
        periodEnd,
        connectionSeconds.get(projectId) ?? null,
      );
      rowsWritten += written;
    } catch (err) {
      log.error('usage_rollup_project_failed', {
        projectId,
        periodStart: periodStart.toISOString(),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info('usage_rollup_done', {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    projects: activeProjects.length,
    rowsWritten,
  });
  return { hoursProcessed: 1, rowsWritten };
}

async function rollUpProject(
  projectId: string,
  periodStart: Date,
  periodEnd: Date,
  connectionSecondsDelta: number | null,
): Promise<number> {
  const [invocations, storage] = await Promise.all([
    getInvocationUsage(projectId, periodStart, periodEnd),
    // Storage is a gauge — sampled at period_end. We approximate by
    // sampling "now"; for a one-hour delay between cron fire and run
    // the drift is negligible at byte-level granularity.
    getStorageUsage(projectId),
  ]);

  const rows: { metric: UsageMetric; value: string }[] = [
    { metric: 'invocations', value: String(invocations.count) },
    { metric: 'storage_bytes', value: String(storage.bytes) },
  ];
  // Only write a connection_seconds row when realtime had activity for
  // this project this hour. The collectConnectionSecondsDeltas() helper
  // returns no entry on a cold scrape (api just booted) and we don't
  // want to over-count by writing zero rows that the Polar push then
  // tries to deliver.
  if (connectionSecondsDelta !== null && connectionSecondsDelta > 0) {
    rows.push({
      metric: 'connection_seconds',
      // Round to integer seconds — Polar meters reject non-finite and
      // some operators configure their meter as integer-typed. Sub-
      // second precision wouldn't survive Polar's aggregation anyway.
      value: String(Math.round(connectionSecondsDelta)),
    });
  }

  // MAU is a 30-day gauge — only meaningful when this project has auth
  // enabled (otherwise the `_briven_auth_sessions` table doesn't exist
  // and the query would error). Skip silently when off; surface a single
  // log line so operators can spot tenants that turned auth off mid-month.
  try {
    if (await isAuthEnabled(projectId)) {
      const mau = await getAuthMauStats(projectId);
      rows.push({ metric: 'auth_mau', value: String(mau.count) });
    }
  } catch (err) {
    log.warn('usage_rollup_auth_mau_failed', {
      projectId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const db = getDb();
  for (const row of rows) {
    await persistUsageEvent(db, projectId, row.metric, periodStart, periodEnd, row.value);
  }
  return rows.length;
}

/**
 * The single billing period a metric's value belongs to:
 *   - GAUGE  → first millisecond of the UTC month containing `hourEnd`
 *     (≈ "now"); the gauge value is the level as-of the end of the hour, so
 *     it's filed under the month that instant falls in. Using hourEnd (not
 *     hourStart) keeps the boundary hour [23:00 last-day, 00:00 first-day)
 *     filing the new month's near-zero count under the NEW month instead of
 *     clobbering the old month's final value.
 *   - COUNTER → the hour itself (`hourStart`).
 */
export function usagePeriodStart(metric: UsageMetric, hourStart: Date, hourEnd: Date): Date {
  return isGaugeMetric(metric) ? currentMonthBounds(hourEnd).periodStart : hourStart;
}

/**
 * UPSERT one usage sample, keyed by the metric's billing period. For gauges
 * this collapses every hourly snapshot of a month onto ONE row (latest
 * value wins); for counters it's one row per hour. A conflict re-arms the
 * Polar push (status→pending, pushedAt→null) so the freshest value goes
 * out. `pushed_value` is deliberately left untouched here — only the push
 * advances it on a successful delivery, which is what makes the gauge
 * delta-to-latest idempotent (a re-push with an unchanged value is a 0
 * delta and bills nothing). Exported so the integration probe drives the
 * real storage path, not a reimplementation.
 */
export async function persistUsageEvent(
  db: DbHandle,
  projectId: string,
  metric: UsageMetric,
  hourStart: Date,
  hourEnd: Date,
  value: string,
): Promise<void> {
  const periodStart = usagePeriodStart(metric, hourStart, hourEnd);
  await db
    .insert(usageEvents)
    .values({
      id: newId('ue'),
      projectId,
      metric,
      periodStart,
      value,
      polarPushStatus: 'pending',
    })
    .onConflictDoUpdate({
      target: [usageEvents.projectId, usageEvents.periodStart, usageEvents.metric],
      set: {
        value,
        // Conflict = re-ran an hour (counter) or a fresher monthly gauge
        // snapshot. Re-arm the push so the updated value goes to Polar; the
        // delta-to-latest math (pushed_value preserved) prevents any
        // double-bill on the gauge side.
        polarPushStatus: 'pending',
        polarPushedAt: null,
      },
    });
}

const INTERVAL_MS = HOUR_MS;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the hourly aggregation cron. Calls aggregateUsageForCompletedHour
 * ~5 minutes after every wall-clock hour boundary so the previous hour's
 * function_logs are fully durable before we count them. Idempotent — a
 * second call is a no-op.
 */
export function startUsageAggregator(): void {
  if (timer) return;
  if (!env.BRIVEN_DATABASE_URL) {
    log.warn('usage_aggregator_skipped_no_db');
    return;
  }
  const align = () => {
    const now = new Date();
    const nextHour = currentHourStart(new Date(now.getTime() + HOUR_MS));
    const offset = nextHour.getTime() - now.getTime() + 5 * 60 * 1000; // +5min
    setTimeout(() => {
      void aggregateUsageForCompletedHour();
      timer = setInterval(() => {
        void aggregateUsageForCompletedHour();
      }, INTERVAL_MS);
    }, offset).unref?.();
  };
  align();
  log.info('usage_aggregator_armed');
}

/**
 * Number of pending usage rows waiting for the Polar push worker.
 * Exposed for /metrics + the admin "Polar push" dashboard.
 */
export async function countPendingPolarPushes(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ n: drizzleSql<number>`count(*)::int` })
    .from(usageEvents)
    .where(and(eq(usageEvents.polarPushStatus, 'pending')));
  return row?.n ?? 0;
}
