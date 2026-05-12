import { and, eq, isNull, sql as drizzleSql } from 'drizzle-orm';

import { newId } from '@briven/shared';

import { getDb } from '../db/client.js';
import { projects, usageEvents, type UsageMetric } from '../db/schema.js';
import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { collectConnectionSecondsDeltas } from '../services/connection-seconds.js';
import { getInvocationUsage, getStorageUsage } from '../services/usage.js';

/**
 * Hourly usage aggregator. For each non-deleted project:
 *   1. invocations — count + duration from function_logs for the hour
 *      window [period_start, period_start + 1h)
 *   2. storage_bytes — pg_total_relation_size sample at period_end
 *   3. connection_seconds — scrape briven_realtime_connection_seconds_total
 *      from realtime /metrics, compute delta vs previous period
 *
 * One row per (project, hour, metric). Idempotent via the unique
 * index so re-running the cron for a missed hour just overwrites the
 * previous attempt — safe for catch-up after a restart.
 *
 * Polar push is a separate worker (`push-polar-meters.ts`, follow-up)
 * that scans WHERE polar_push_status='pending'. Until that lands rows
 * stay pending and the operator can verify the data via SQL.
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

  const db = getDb();
  for (const row of rows) {
    await db
      .insert(usageEvents)
      .values({
        id: newId('au'),
        projectId,
        metric: row.metric,
        periodStart,
        value: row.value,
        polarPushStatus: 'pending',
      })
      .onConflictDoUpdate({
        target: [usageEvents.projectId, usageEvents.periodStart, usageEvents.metric],
        set: {
          value: row.value,
          // Conflict means we re-ran an hour. Reset push status so the
          // updated value goes out to Polar (the previous attempt was
          // either stale or never pushed).
          polarPushStatus: 'pending',
          polarPushedAt: null,
        },
      });
  }
  return rows.length;
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
