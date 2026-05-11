import { and, asc, eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { usageEvents, type UsageEvent, type UsageMetric } from '../db/schema.js';
import { env } from '../env.js';
import { log } from '../lib/logger.js';

/**
 * Polar metering push — drains pending usage_events rows into Polar's
 * meter API. Each metric maps to one Polar meter id:
 *
 *   invocations         → BRIVEN_POLAR_METER_INVOCATIONS_ID
 *   storage_bytes       → BRIVEN_POLAR_METER_STORAGE_ID
 *   connection_seconds  → BRIVEN_POLAR_METER_CONNECTION_ID
 *
 * Without the meter ids configured the worker marks rows as 'skipped'
 * so they don't pile up forever (and a follow-up env config flip can
 * re-enable them by resetting status='pending').
 *
 * Push status transitions (see usageEvents.polarPushStatus):
 *   pending → pushed   (HTTP 2xx from Polar)
 *   pending → skipped  (no meter id configured for the metric)
 *   pending → pending  (transient failure, retried next tick)
 */

/** Batch size — keep round-trips small so a single Polar outage doesn't lock up the cron. */
const BATCH_SIZE = 50;
/** Cron interval — once per minute. Each tick drains up to BATCH_SIZE rows. */
const INTERVAL_MS = 60_000;

/**
 * Polar customer id required for the meter payload. Phase 1 we don't
 * yet store a per-project polar customer id — when that wires we add
 * a projects.polar_customer_id column and read it here. Until then this
 * helper is a stub that returns null and the worker marks the row
 * pending → skipped with reason='no_customer'.
 */
function polarCustomerForProject(_projectId: string): string | null {
  return null;
}

function meterIdFor(metric: UsageMetric): string | null {
  switch (metric) {
    case 'invocations':
      return env.BRIVEN_POLAR_METER_INVOCATIONS_ID ?? null;
    case 'storage_bytes':
      return env.BRIVEN_POLAR_METER_STORAGE_ID ?? null;
    case 'connection_seconds':
      return env.BRIVEN_POLAR_METER_CONNECTION_ID ?? null;
    default:
      return null;
  }
}

/**
 * Push one row. Returns the new status — caller writes it back.
 * Phase 3 gate: without an access token + meter id + customer id we
 * mark 'skipped' and log the intent. Operators verify what we WOULD
 * have pushed via the admin usage page.
 */
async function pushOne(row: UsageEvent): Promise<'pushed' | 'skipped' | 'pending'> {
  if (!env.BRIVEN_POLAR_ACCESS_TOKEN) {
    log.info('polar_push_skipped_no_token', {
      eventId: row.id,
      projectId: row.projectId,
      metric: row.metric,
    });
    return 'skipped';
  }
  const meterId = meterIdFor(row.metric);
  if (!meterId) {
    log.info('polar_push_skipped_no_meter', {
      eventId: row.id,
      projectId: row.projectId,
      metric: row.metric,
    });
    return 'skipped';
  }
  const customerId = polarCustomerForProject(row.projectId);
  if (!customerId) {
    log.info('polar_push_skipped_no_customer', {
      eventId: row.id,
      projectId: row.projectId,
      metric: row.metric,
    });
    return 'skipped';
  }
  // Polar Meters API: POST {base}/v1/meters/{meter_id}/events
  //   { customer_id, value: number, timestamp: ISO8601 }
  // Wired but not yet invoked — leaving the payload assembled here so
  // the operator can see exactly what we'd send by greping for
  // polar_push_intent in the logs. Switch to a real fetch() once the
  // sandbox setup is complete + we've verified one end-to-end push.
  log.info('polar_push_intent', {
    eventId: row.id,
    projectId: row.projectId,
    metric: row.metric,
    meterId,
    customerId,
    value: Number.parseFloat(row.value),
    timestamp: row.periodStart.toISOString(),
  });
  return 'pending';
}

export async function drainPendingPolarPushes(): Promise<{
  scanned: number;
  pushed: number;
  skipped: number;
}> {
  const db = getDb();
  const rows = await db
    .select()
    .from(usageEvents)
    .where(eq(usageEvents.polarPushStatus, 'pending'))
    .orderBy(asc(usageEvents.periodStart))
    .limit(BATCH_SIZE);

  let pushed = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      const next = await pushOne(row);
      if (next === 'pushed') {
        await db
          .update(usageEvents)
          .set({ polarPushStatus: 'pushed', polarPushedAt: new Date() })
          .where(and(eq(usageEvents.id, row.id)));
        pushed += 1;
      } else if (next === 'skipped') {
        await db
          .update(usageEvents)
          .set({ polarPushStatus: 'skipped' })
          .where(and(eq(usageEvents.id, row.id)));
        skipped += 1;
      }
      // 'pending' = retry next tick — don't touch the row.
    } catch (err) {
      log.warn('polar_push_row_failed', {
        eventId: row.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (rows.length > 0) {
    log.info('polar_push_drain', {
      scanned: rows.length,
      pushed,
      skipped,
      pending: rows.length - pushed - skipped,
    });
  }
  return { scanned: rows.length, pushed, skipped };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startPolarMeterPush(): void {
  if (timer) return;
  if (!env.BRIVEN_DATABASE_URL) {
    log.warn('polar_meter_push_skipped_no_db');
    return;
  }
  // Initial run 30s after boot so migrations finish + the first
  // aggregator cycle isn't competing for the same rows.
  setTimeout(() => {
    void drainPendingPolarPushes();
    timer = setInterval(() => {
      void drainPendingPolarPushes();
    }, INTERVAL_MS);
  }, 30_000).unref?.();
  log.info('polar_meter_push_armed', { intervalMs: INTERVAL_MS });
}
