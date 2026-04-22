import { createHmac, timingSafeEqual } from 'node:crypto';

import { Hono } from 'hono';
import { z } from 'zod';

import { env } from '../env.js';
import { requireAuth, type Session, type User } from '../middleware/session.js';
import { getTierForOwner, upsertSubscriptionFromPolar } from '../services/billing.js';
import { log } from '../lib/logger.js';

type AppEnv = {
  Variables: {
    user: User | null;
    session: Session | null;
    requestId: string;
  };
};

const checkoutSchema = z.object({
  priceId: z.string().min(1),
  successURL: z.string().url(),
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

billingRouter.get('/v1/billing/tier', async (c) => {
  const user = c.get('user')!;
  const tier = await getTierForOwner(user.id);
  return c.json({ tier });
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
      priceId: parsed.data.priceId,
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
