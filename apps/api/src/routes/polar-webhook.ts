import { Hono } from 'hono';
import { Webhook } from 'standardwebhooks';

import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { audit } from '../services/audit.js';

/**
 * Inbound webhook receiver for Polar.sh — the billing processor.
 *
 * Wire format (Standard Webhooks spec — different from mittera!):
 *   webhook-id:        <event uuid>
 *   webhook-timestamp: <unix seconds>
 *   webhook-signature: v1,<base64>   (space-separated for multiple algos)
 *
 * The `standardwebhooks` npm package handles signature verification +
 * the ±5min replay window. We feed it the raw request body so byte
 * ordering matches what Polar signed.
 *
 * Behaviour matches the mittera handler shape:
 *   - verify signature first; bad/expired → 401
 *   - audit-log every event under `polar.<eventType>`
 *   - for subscription lifecycle events (created/updated/canceled),
 *     dispatch to the tier-sync stub. Until BRIVEN_POLAR_PRO_PRODUCT_ID
 *     and BRIVEN_POLAR_TEAM_PRODUCT_ID are set, the dispatch logs the
 *     intent and acks 200 so Polar doesn't retry. When the product IDs
 *     are set, this is where the project.tier UPDATE lands.
 *
 * Webhook URL to register on the Polar dashboard:
 *   https://api.briven.tech/v1/webhooks/polar
 */

interface PolarEnvelope {
  type?: string;
  data?: {
    id?: string;
    status?: string;
    productId?: string;
    customer?: { id?: string; email?: string };
    metadata?: Record<string, unknown>;
  };
}

const SUBSCRIPTION_EVENTS = new Set([
  'subscription.created',
  'subscription.updated',
  'subscription.canceled',
  'subscription.uncanceled',
  'subscription.revoked',
  'subscription.active',
]);

export const polarWebhookRouter = new Hono();

polarWebhookRouter.post('/v1/webhooks/polar', async (c) => {
  if (!env.BRIVEN_POLAR_WEBHOOK_SECRET) {
    log.warn('polar_webhook_unconfigured');
    return c.json({ code: 'not_configured', message: 'polar webhook secret unset' }, 503);
  }

  const raw = await c.req.text();
  const headers = {
    'webhook-id': c.req.header('webhook-id') ?? '',
    'webhook-timestamp': c.req.header('webhook-timestamp') ?? '',
    'webhook-signature': c.req.header('webhook-signature') ?? '',
  };

  try {
    const wh = new Webhook(env.BRIVEN_POLAR_WEBHOOK_SECRET);
    wh.verify(raw, headers);
  } catch (err) {
    log.warn('polar_webhook_signature_invalid', {
      hasId: Boolean(headers['webhook-id']),
      hasTs: Boolean(headers['webhook-timestamp']),
      hasSig: Boolean(headers['webhook-signature']),
      message: err instanceof Error ? err.message : String(err),
    });
    return c.json({ code: 'invalid_signature', message: 'signature invalid or expired' }, 401);
  }

  let event: PolarEnvelope = {};
  try {
    event = JSON.parse(raw) as PolarEnvelope;
  } catch {
    log.warn('polar_webhook_unparseable_body', { bodyLen: raw.length });
  }

  const eventType = event.type ?? 'unknown';

  log.info('polar_webhook_received', {
    type: eventType,
    eventId: headers['webhook-id'],
    productId: event.data?.productId ?? null,
    status: event.data?.status ?? null,
  });

  // Persist to audit_logs. PII (customer email) intentionally excluded
  // per CLAUDE.md §5.1 — we keep the polar event id + product id so
  // a support inquiry can be correlated, but the customer's identity
  // stays on Polar's side.
  await audit({
    actorId: null,
    projectId: null,
    action: `polar.${eventType}`,
    ipHash: null,
    userAgent: 'polar-webhook',
    metadata: {
      eventId: headers['webhook-id'],
      subscriptionId: event.data?.id ?? null,
      productId: event.data?.productId ?? null,
      status: event.data?.status ?? null,
    },
  });

  // Subscription lifecycle — dispatch to tier-sync. The actual project
  // tier UPDATE is deferred until the BRIVEN_POLAR_*_PRODUCT_ID env
  // vars are set; until then we log the intent and ack 200 so Polar
  // doesn't retry.
  if (SUBSCRIPTION_EVENTS.has(eventType)) {
    const productId = event.data?.productId ?? null;
    const targetTier = resolveTierForProduct(productId);
    log.info('polar_tier_sync_intent', {
      eventType,
      subscriptionId: event.data?.id ?? null,
      productId,
      targetTier,
      // Once tier-sync is wired, this is where we'd update the
      // matching project's tier. For now we surface the intent.
      noop: targetTier === null ? 'no matching product id configured' : 'wiring pending',
    });
  }

  return c.json({ ok: true });
});

/**
 * Map Polar product id → briven tier. Returns null when the product
 * isn't configured (env var unset) or doesn't match a known tier.
 * Exported for tests.
 */
export function resolveTierForProduct(productId: string | null): 'pro' | 'team' | null {
  if (!productId) return null;
  if (env.BRIVEN_POLAR_PRO_PRODUCT_ID && productId === env.BRIVEN_POLAR_PRO_PRODUCT_ID) return 'pro';
  if (env.BRIVEN_POLAR_TEAM_PRODUCT_ID && productId === env.BRIVEN_POLAR_TEAM_PRODUCT_ID)
    return 'team';
  return null;
}
