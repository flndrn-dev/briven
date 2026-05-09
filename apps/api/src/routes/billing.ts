import { Hono } from 'hono';
import { Webhook, WebhookVerificationError } from 'standardwebhooks';
import { z } from 'zod';

import { env } from '../env.js';
import { requireAuth, type Session, type User } from '../middleware/session.js';
import {
  checkVatWithVies,
  configuredPlans,
  createCheckout,
  createCustomerPortalSession,
  getSubscriptionForOrg,
  getTierForOrg,
  upsertSubscriptionFromPolar,
} from '../services/billing.js';
import { log } from '../lib/logger.js';
import { getDefaultOrgForUser } from '../services/orgs.js';

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
      // nullish: Polar sends null (not undefined) for fields that don't
      // apply to a given event type — e.g. product.* events have no
      // customer_id. Accept both null and undefined.
      customer_id: z.string().nullish(),
      customer: z.object({ id: z.string() }).passthrough().nullish(),
      product_id: z.string().nullish(),
      product: z.object({ id: z.string() }).passthrough().nullish(),
      status: z.string().nullish(),
      current_period_end: z.string().nullish(),
      canceled_at: z.string().nullish(),
      metadata: z.record(z.string(), z.unknown()).nullish(),
    })
    .passthrough(),
});

export const billingRouter = new Hono<AppEnv>();

billingRouter.use('/v1/billing/tier', requireAuth());
billingRouter.use('/v1/billing/checkout', requireAuth());
billingRouter.use('/v1/billing/plans', requireAuth());
billingRouter.use('/v1/billing/subscription', requireAuth());
billingRouter.use('/v1/billing/portal', requireAuth());
billingRouter.use('/v1/billing/vat/check', requireAuth());

billingRouter.get('/v1/billing/tier', async (c) => {
  const user = c.get('user')!;
  const org = await getDefaultOrgForUser(user.id);
  const tier = await getTierForOrg(org.id);
  return c.json({ tier });
});

billingRouter.get('/v1/billing/subscription', async (c) => {
  const user = c.get('user')!;
  const org = await getDefaultOrgForUser(user.id);
  const summary = await getSubscriptionForOrg(org.id);
  return c.json(summary);
});

/**
 * Live VAT check against the EU VIES REST API. Returns one of:
 *   valid          – VIES confirms it is a registered VAT number
 *   invalid        – VIES confirms it does not exist (or format is bad)
 *   unverifiable   – VIES was unreachable / that country's registry is
 *                    timing out. Caller should let the user proceed but
 *                    flag the number as unverified.
 *
 * VIES is known to be per-country flaky, so we never block on a transient
 * outage — the customer can still check out and we re-check on the next
 * profile update.
 */
billingRouter.get('/v1/billing/vat/check', async (c) => {
  const raw = c.req.query('id') ?? '';
  const result = await checkVatWithVies(raw);
  return c.json(result);
});

billingRouter.post('/v1/billing/portal', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = portalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const org = await getDefaultOrgForUser(user.id);
  const summary = await getSubscriptionForOrg(org.id);
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
    const result = await createCustomerPortalSession(
      summary.polarCustomerId,
      parsed.data.returnURL,
    );
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
    const org = await getDefaultOrgForUser(user.id);
    const result = await createCheckout({
      orgId: org.id,
      createdByUserId: user.id,
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

  // Polar deviates from the Standard Webhooks spec on secret handling.
  // Per polar-python's validate_event (src/polar_sdk/_webhooks/__init__.py),
  // the reference implementation is:
  //   base64_secret = base64.b64encode(secret.encode()).decode()
  //   webhook = Webhook(base64_secret)
  // i.e. base64-encode the FULL secret string (including the `polar_whs_`
  // prefix) and hand THAT to the library, which base64-decodes it and
  // HMAC's with those raw ASCII bytes. Do NOT strip the prefix.
  const encodedSecret = Buffer.from(secret, 'utf8').toString('base64');

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
  // Prefer orgId (the current schema). Legacy events from before migration
  // 0010 only carry ownerId — resolve them to the user's personal org so
  // redelivery of pre-migration events still lands correctly.
  let orgId: string | null = typeof meta.orgId === 'string' ? meta.orgId : null;
  if (!orgId) {
    const legacyOwnerId = typeof meta.ownerId === 'string' ? meta.ownerId : null;
    if (legacyOwnerId) {
      try {
        const personalOrg = await getDefaultOrgForUser(legacyOwnerId);
        orgId = personalOrg.id;
      } catch {
        // fall through to no_org branch
      }
    }
  }
  if (!orgId) {
    log.warn('polar_webhook_no_org', { type: payload.type, subscriptionId: data.id });
    return c.json({ ok: true, ignored: 'no_org' });
  }

  const status = data.status ?? (payload.type === 'subscription.canceled' ? 'canceled' : 'active');

  await upsertSubscriptionFromPolar({
    polarSubscriptionId: data.id,
    polarCustomerId: customerId,
    polarProductId: productId,
    orgId,
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
