import { createHmac, timingSafeEqual } from 'node:crypto';

import { Hono } from 'hono';
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

const webhookSchema = z.object({
  type: z.enum(['subscription.created', 'subscription.updated', 'subscription.canceled']),
  data: z.object({
    id: z.string(),
    customer_id: z.string(),
    product_id: z.string(),
    status: z.string(),
    current_period_end: z.string().nullable().optional(),
    canceled_at: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
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
  const signature = c.req.header('webhook-signature') ?? '';

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signature.replace(/^sha256=/, '');
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    log.warn('polar_webhook_bad_signature');
    return c.json({ code: 'bad_signature' }, 401);
  }

  let payload: z.infer<typeof webhookSchema>;
  try {
    payload = webhookSchema.parse(JSON.parse(rawBody));
  } catch {
    return c.json({ code: 'bad_payload' }, 400);
  }

  const meta = (payload.data.metadata as Record<string, unknown> | null) ?? {};
  const ownerId = typeof meta.ownerId === 'string' ? meta.ownerId : null;
  if (!ownerId) {
    // A webhook without our metadata isn't addressable — log and accept
    // so Polar doesn't retry forever.
    log.warn('polar_webhook_no_owner', { subscriptionId: payload.data.id });
    return c.json({ ok: true });
  }

  await upsertSubscriptionFromPolar({
    polarSubscriptionId: payload.data.id,
    polarCustomerId: payload.data.customer_id,
    polarProductId: payload.data.product_id,
    ownerId,
    status: statusFromPolar(payload.data.status),
    currentPeriodEnd: payload.data.current_period_end
      ? new Date(payload.data.current_period_end)
      : null,
    canceledAt: payload.data.canceled_at ? new Date(payload.data.canceled_at) : null,
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
