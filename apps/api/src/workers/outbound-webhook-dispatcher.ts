import { createHmac } from 'node:crypto';

import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { getDb } from '../db/client.js';
import { webhookSubscribers } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import {
  claimDueDeliveries,
  decryptSubscriberSecret,
  recordDeliveryResult,
} from '../services/outbound-webhooks.js';

/**
 * Outbound webhook dispatcher. Every TICK_MS:
 *   1. claim up to BATCH_SIZE pending deliveries whose next_attempt_at
 *      has passed.
 *   2. for each delivery: decrypt the subscriber's secret, sign the
 *      payload, POST to target_url.
 *   3. record the outcome — on success mark `ok`; on failure schedule
 *      the next attempt with exponential backoff up to MAX_ATTEMPTS,
 *      then mark `failed`.
 *
 * Concurrency: deliveries to different subscribers fan out in parallel.
 * Subscriber-level ordering is best-effort — strict per-subscriber
 * serialisation would need explicit locking, and outbound webhooks are
 * intentionally at-least-once with customer-side dedupe on event_id.
 */

const TICK_MS = 30_000;
const BATCH_SIZE = 50;
const HTTP_TIMEOUT_MS = 10_000;
const MAX_ERROR_LEN = 500;
// Match the constant in services/outbound-webhooks.ts (we don't want a
// runtime import cycle just to share a number).
const MAX_ATTEMPTS = 5;

let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;

async function tick(): Promise<void> {
  if (inflight) {
    log.warn('outbound_webhook_dispatcher_tick_skipped_inflight');
    return;
  }
  inflight = true;
  const now = new Date();
  try {
    const due = await claimDueDeliveries(now, BATCH_SIZE);
    if (due.length === 0) return;
    log.info('outbound_webhook_dispatcher_tick', { dueCount: due.length });
    await Promise.all(due.map((d) => fireOne(d, now)));
  } catch (err) {
    log.error('outbound_webhook_dispatcher_tick_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inflight = false;
  }
}

async function fireOne(
  delivery: Awaited<ReturnType<typeof claimDueDeliveries>>[number],
  now: Date,
): Promise<void> {
  const attemptCount = Number(delivery.attemptCount);
  const db = getDb();
  const subRows = await db
    .select()
    .from(webhookSubscribers)
    .where(eq(webhookSubscribers.id, delivery.subscriberId))
    .limit(1);
  const subscriber = subRows[0];
  if (!subscriber || !subscriber.enabled || subscriber.deletedAt) {
    // Subscriber was paused or deleted between claim and dispatch. Force
    // the row to its terminal `failed` state by passing the
    // last-retry-slot attempt count to the recorder. No HTTP attempted.
    await recordDeliveryResult({
      deliveryId: delivery.id,
      attemptCount: MAX_ATTEMPTS - 1,
      statusCode: null,
      durationMs: 0,
      errorMessage: 'subscriber disabled or deleted between claim and dispatch',
      ok: false,
      ranAt: now,
    });
    return;
  }

  const secret = decryptSubscriberSecret(subscriber);
  const body = JSON.stringify(delivery.payload);
  const timestamp = String(now.getTime());
  const signature = `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

  let statusCode: number | null = null;
  let errorMessage: string | null = null;
  let ok = false;

  const t0 = Date.now();
  try {
    const res = await fetch(subscriber.targetUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-briven-signature': signature,
        'x-briven-timestamp': timestamp,
        'x-briven-event': delivery.eventType,
        'x-briven-event-id': delivery.eventId,
        'user-agent': `briven-webhook/1.0 (${env.BRIVEN_API_ORIGIN})`,
      },
      body,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    statusCode = res.status;
    ok = res.status >= 200 && res.status < 300;
    if (!ok) {
      const text = await res.text().catch(() => '');
      errorMessage = `${res.status}: ${text.slice(0, MAX_ERROR_LEN)}`;
    }
  } catch (err) {
    errorMessage = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_LEN);
  }
  const durationMs = Date.now() - t0;

  await recordDeliveryResult({
    deliveryId: delivery.id,
    attemptCount,
    statusCode,
    durationMs,
    errorMessage,
    ok,
    ranAt: now,
  });
}

export function startOutboundWebhookDispatcher(): void {
  if (timer) return;
  if (!env.BRIVEN_URL) {
    log.warn('outbound_webhook_dispatcher_skipped_no_db');
    return;
  }
  // 75s after boot — sits between schedule (45s) and retention (90s)
  // so the three workers don't all hit the connection pool together.
  setTimeout(() => {
    void tick();
    timer = setInterval(() => {
      void tick();
    }, TICK_MS);
  }, 75_000).unref?.();
  log.info('outbound_webhook_dispatcher_armed', { tickMs: TICK_MS, batch: BATCH_SIZE });
}

export function stopOutboundWebhookDispatcher(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Exported for tests.
export const _internals = { tick, fireOne };
