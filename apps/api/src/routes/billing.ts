import { Hono } from 'hono';
import { Webhook, WebhookVerificationError } from 'standardwebhooks';
import { z } from 'zod';

import { env } from '../env.js';
import { requireAuth, type Session, type User } from '../middleware/session.js';
import {
  configuredPlans,
  createCustomerPortalSession,
  getSubscriptionForOwner,
  getTierForOwner,
  upsertSubscriptionFromPolar,
} from '../services/billing.js';
import { log } from '../lib/logger.js';

type AppEnv = {
  Variables: {
    user: User | null;
    session: Session | null;
    requestId: string;
  };
};

const checkoutSchema = z.object({
  tier: z.enum(['pro', 'team']),
  successURL: z.string().url(),
});

const portalSchema = z.object({
  returnURL: z.string().url(),
});

// Polar's webhook payload has evolved — some events carry flat ids
// (`customer_id`, `product_id`) while newer subscription/order events nest
// the full object. Accept both shapes and resolve at read time.
const webhookSchema = z.object({
  type: z.string(),
  data: z
    .object({
      id: z.string(),
      customer_id: z.string().optional(),
      customer: z.object({ id: z.string() }).passthrough().optional(),
      product_id: z.string().optional(),
      product: z.object({ id: z.string() }).passthrough().optional(),
      status: z.string().optional(),
      current_period_end: z.string().nullable().optional(),
      canceled_at: z.string().nullable().optional(),
      metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    })
    .passthrough(),
});

export const billingRouter = new Hono<AppEnv>();

billingRouter.use('/v1/billing/tier', requireAuth());
billingRouter.use('/v1/billing/checkout', requireAuth());
billingRouter.use('/v1/billing/plans', requireAuth());
billingRouter.use('/v1/billing/subscription', requireAuth());
billingRouter.use('/v1/billing/portal', requireAuth());

billingRouter.get('/v1/billing/tier', async (c) => {
  const user = c.get('user')!;
  const tier = await getTierForOwner(user.id);
  return c.json({ tier });
});

billingRouter.get('/v1/billing/subscription', async (c) => {
  const user = c.get('user')!;
  const summary = await getSubscriptionForOwner(user.id);
  return c.json(summary);
});

billingRouter.post('/v1/billing/portal', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = portalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const summary = await getSubscriptionForOwner(user.id);
  if (!summary.polarCustomerId) {
    return c.json(
      {
        code: 'no_customer',
        message: 'no paid subscription yet — start one via checkout first',
      },
      404,
    );
  }
  try {
    const result = await createCustomerPortalSession(summary.polarCustomerId, parsed.data.returnURL);
    return c.json(result);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) {
      const e = err as { code: string; message: string; status?: number };
      return c.json({ code: e.code, message: e.message }, (e.status ?? 500) as never);
    }
    throw err;
  }
});

/**
 * Plans the user can check out into. Empty array when Polar product UUIDs
 * aren't configured — the UI uses this to gate the upgrade buttons.
 */
billingRouter.get('/v1/billing/plans', async (c) => {
  const plans = configuredPlans().map((p) => ({
    tier: p.tier,
    // The product id is the only identifier the client needs to reason about
    // a plan; nothing else about the Polar product leaks through here.
    productId: p.productId,
  }));
  return c.json({ plans });
});

billingRouter.post('/v1/billing/checkout', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  try {
    const { createCheckout } = await import('../services/billing.js');
    const result = await createCheckout({
      ownerId: user.id,
      email: user.email,
      tier: parsed.data.tier,
      successURL: parsed.data.successURL,
    });
    return c.json(result);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) {
      const e = err as { code: string; message: string; status?: number };
      return c.json({ code: e.code, message: e.message }, (e.status ?? 500) as never);
    }
    throw err;
  }
});

/**
 * Polar.sh webhook endpoint. HMAC-validated with BRIVEN_POLAR_WEBHOOK_SECRET.
 * Idempotent upserts on subscription row.
 */
billingRouter.post('/v1/billing/webhook', async (c) => {
  const secret = env.BRIVEN_POLAR_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ code: 'not_configured' }, 503);
  }

  const rawBody = await c.req.text();

  // Polar follows Standard Webhooks with one important wrinkle documented
  // at polar.sh/docs/integrate/webhooks/delivery: Polar signs with the
  // *raw ASCII bytes* of the secret string (minus the `polar_whs_` prefix),
  // whereas the Standard Webhooks library treats its input as base64 and
  // decodes it. Bridge the gap by base64-encoding the raw secret before
  // handing it in — the library then decodes it back to those ASCII bytes
  // and HMAC'ing matches Polar's signature.
  const rawSecret = secret.startsWith('polar_whs_')
    ? secret.slice('polar_whs_'.length)
    : secret.startsWith('whsec_')
    ? secret.slice('whsec_'.length)
    : secret;
  const encodedSecret = Buffer.from(rawSecret, 'utf8').toString('base64');

  const wh = new Webhook(encodedSecret);
  try {
    wh.verify(rawBody, {
      'webhook-id': c.req.header('webhook-id') ?? '',
      'webhook-timestamp': c.req.header('webhook-timestamp') ?? '',
      'webhook-signature': c.req.header('webhook-signature') ?? '',
    });
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      log.warn('polar_webhook_bad_signature', { message: err.message });
      return c.json({ code: 'bad_signature' }, 401);
    }
    throw err;
  }

  let payload: z.infer<typeof webhookSchema>;
  try {
    payload = webhookSchema.parse(JSON.parse(rawBody));
  } catch (err) {
    log.warn('polar_webhook_bad_payload', {
      message: err instanceof Error ? err.message : String(err),
    });
    return c.json({ code: 'bad_payload' }, 400);
  }

  // Polar fires many event types; we only care about subscription
  // lifecycle ones. Everything else gets a 200 so Polar doesn't retry.
  const SUBSCRIPTION_EVENTS = new Set([
    'subscription.created',
    'subscription.active',
    'subscription.updated',
    'subscription.canceled',
  ]);
  if (!SUBSCRIPTION_EVENTS.has(payload.type)) {
    return c.json({ ok: true, ignored: payload.type });
  }

  const data = payload.data;
  const customerId = data.customer_id ?? data.customer?.id ?? null;
  const productId = data.product_id ?? data.product?.id ?? null;
  if (!customerId || !productId) {
    log.warn('polar_webhook_missing_ids', {
      type: payload.type,
      subscriptionId: data.id,
    });
    return c.json({ ok: true, ignored: 'missing_ids' });
  }

  const meta = (data.metadata as Record<string, unknown> | null) ?? {};
  const ownerId = typeof meta.ownerId === 'string' ? meta.ownerId : null;
  if (!ownerId) {
    // why: Polar carries our metadata on checkout, but for events fired
    // before the first successful checkout (abandoned flows, etc.) the
    // owner is unknown. Ack so Polar stops retrying — no state to write.
    log.warn('polar_webhook_no_owner', { type: payload.type, subscriptionId: data.id });
    return c.json({ ok: true, ignored: 'no_owner' });
  }

  const status = data.status ?? (payload.type === 'subscription.canceled' ? 'canceled' : 'active');

  await upsertSubscriptionFromPolar({
    polarSubscriptionId: data.id,
    polarCustomerId: customerId,
    polarProductId: productId,
    ownerId,
    status: statusFromPolar(status),
    currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end) : null,
    canceledAt: data.canceled_at ? new Date(data.canceled_at) : null,
  });
  return c.json({ ok: true });
});

function statusFromPolar(raw: string): 'active' | 'past_due' | 'canceled' | 'trialing' {
  switch (raw) {
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'cancelled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return 'active';
  }
}
