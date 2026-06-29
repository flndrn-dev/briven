import { and, asc, eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { projects, subscriptions, usageEvents, type UsageEvent, type UsageMetric } from '../db/schema.js';
import { env } from '../env.js';
import { log } from '../lib/logger.js';

/**
 * Polar metering push — drains pending usage_events rows into Polar's
 * meter API. Each metric maps to one Polar meter id:
 *
 *   invocations         → BRIVEN_POLAR_METER_INVOCATIONS_ID
 *   storage_bytes       → BRIVEN_POLAR_METER_STORAGE_ID
 *   connection_seconds  → BRIVEN_POLAR_METER_CONNECTION_ID
 *   auth_mau            → BRIVEN_POLAR_METER_AUTH_MAU_ID
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
 * Polar customer id required for the meter payload. Resolved through
 * the project's org's subscription row — subscriptions are org-level
 * (CLAUDE.md §3.3) and Polar tracks billing per customer at the same
 * grain. Returns null when the org has no subscription yet, in which
 * case the worker marks the row pending → skipped with reason
 * 'no_customer' so it doesn't pile up forever; the next checkout
 * stamps the customer id and a follow-up cron can re-enable skipped
 * rows by resetting status='pending'.
 *
 * In-process cache with a 5-minute TTL — every pending row hits this
 * during a drain and we don't want to hammer the meta-DB. Subscription
 * upserts on the Polar webhook path invalidate the entry so a fresh
 * customer id takes effect on the next tick, not after the TTL.
 */
interface CustomerCacheEntry {
  customerId: string | null;
  expiresAt: number;
}
const CUSTOMER_CACHE_TTL_MS = 5 * 60_000;
const customerCache = new Map<string, CustomerCacheEntry>();

export function invalidatePolarCustomerCache(projectId: string): void {
  customerCache.delete(projectId);
}

async function polarCustomerForProject(projectId: string): Promise<string | null> {
  const now = Date.now();
  const hit = customerCache.get(projectId);
  if (hit && hit.expiresAt > now) {
    return hit.customerId;
  }
  const db = getDb();
  const [row] = await db
    .select({ polarCustomerId: subscriptions.polarCustomerId })
    .from(projects)
    .innerJoin(subscriptions, eq(subscriptions.orgId, projects.orgId))
    .where(eq(projects.id, projectId))
    .limit(1);
  const customerId = row?.polarCustomerId ?? null;
  customerCache.set(projectId, { customerId, expiresAt: now + CUSTOMER_CACHE_TTL_MS });
  return customerId;
}

function meterIdFor(metric: UsageMetric): string | null {
  switch (metric) {
    case 'invocations':
      return env.BRIVEN_POLAR_METER_INVOCATIONS_ID ?? null;
    case 'storage_bytes':
      return env.BRIVEN_POLAR_METER_STORAGE_ID ?? null;
    case 'connection_seconds':
      return env.BRIVEN_POLAR_METER_CONNECTION_ID ?? null;
    case 'auth_mau':
      return env.BRIVEN_POLAR_METER_AUTH_MAU_ID ?? null;
    default:
      return null;
  }
}

/**
 * Push one row. Returns the new status — caller writes it back.
 *
 * Without an access token + meter id + customer id the row is marked
 * 'skipped'. With all three present we POST to Polar's Meters API.
 * Network or 5xx → 'pending' (retried on the next tick); 4xx → 'skipped'
 * (operator must intervene — a 400 from Polar is durable, not transient).
 *
 * Operator-visible logs:
 *   polar_push_pushed      — 2xx response, row → 'pushed'
 *   polar_push_skipped_*   — see reason field; row → 'skipped'
 *   polar_push_retry       — transient failure; row stays 'pending'
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
  const customerId = await polarCustomerForProject(row.projectId);
  if (!customerId) {
    log.info('polar_push_skipped_no_customer', {
      eventId: row.id,
      projectId: row.projectId,
      metric: row.metric,
    });
    return 'skipped';
  }

  // Polar Meters API — POST {base}/v1/meters/{meter_id}/events
  //   { customer_id, value: number, timestamp: ISO8601 }
  const value = Number.parseFloat(row.value);
  if (!Number.isFinite(value)) {
    log.warn('polar_push_skipped_bad_value', {
      eventId: row.id,
      projectId: row.projectId,
      metric: row.metric,
      raw: row.value,
    });
    return 'skipped';
  }

  let res: Response;
  try {
    res = await fetch(`${env.BRIVEN_POLAR_API_BASE}/v1/meters/${meterId}/events`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.BRIVEN_POLAR_ACCESS_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customer_id: customerId,
        value,
        timestamp: row.periodStart.toISOString(),
      }),
    });
  } catch (err) {
    log.warn('polar_push_retry', {
      eventId: row.id,
      projectId: row.projectId,
      metric: row.metric,
      reason: 'network',
      message: err instanceof Error ? err.message : String(err),
    });
    return 'pending';
  }

  if (res.ok) {
    log.info('polar_push_pushed', {
      eventId: row.id,
      projectId: row.projectId,
      metric: row.metric,
      meterId,
      value,
    });
    return 'pushed';
  }

  // 5xx is transient (Polar restarted, rate-limited, etc.) — leave the
  // row pending and let the next tick retry. 4xx is durable (bad meter
  // id, customer mismatch, validation) — mark skipped so we don't loop
  // forever; an operator can re-enable after fixing the underlying issue.
  const transient = res.status >= 500 || res.status === 429;
  const body = await res.text().catch(() => '');
  log.warn(transient ? 'polar_push_retry' : 'polar_push_skipped_4xx', {
    eventId: row.id,
    projectId: row.projectId,
    metric: row.metric,
    status: res.status,
    body: body.slice(0, 256),
  });
  return transient ? 'pending' : 'skipped';
}

export async function drainPendingPolarPushes(): Promise<{
  scanned: number;
  pushed: number;
  skipped: number;
}> {
  const db = getDb();

  // Claim the batch with FOR UPDATE SKIP LOCKED inside a transaction so a
  // second drainer instance (or an overlapping tick) can NEVER select the
  // same pending rows — that would push the same usage to Polar twice and
  // double-bill the customer. SKIP LOCKED means the other instance simply
  // grabs a different batch instead of blocking. The row locks are held for
  // the batch's lifetime (incl. the Polar HTTP calls); acceptable here — this
  // is a low-volume background metering drainer, not a hot path.
  let pushed = 0;
  let skipped = 0;
  let scanned = 0;
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.polarPushStatus, 'pending'))
      .orderBy(asc(usageEvents.periodStart))
      .limit(BATCH_SIZE)
      .for('update', { skipLocked: true });
    scanned = rows.length;

    for (const row of rows) {
      try {
        const next = await pushOne(row);
        if (next === 'pushed') {
          await tx
            .update(usageEvents)
            .set({ polarPushStatus: 'pushed', polarPushedAt: new Date() })
            .where(and(eq(usageEvents.id, row.id)));
          pushed += 1;
        } else if (next === 'skipped') {
          await tx
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
  });

  if (scanned > 0) {
    log.info('polar_push_drain', {
      scanned,
      pushed,
      skipped,
      pending: scanned - pushed - skipped,
    });
  }
  return { scanned, pushed, skipped };
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
