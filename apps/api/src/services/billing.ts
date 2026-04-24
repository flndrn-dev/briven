import { brivenError } from '@briven/shared';
import { eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { subscriptions, type SubscriptionStatus } from '../db/schema.js';
import { env } from '../env.js';
import { log } from '../lib/logger.js';
import type { ProjectTier } from '../db/schema.js';

/**
 * Polar.sh integration.
 *
 * Tier mapping is env-driven: BRIVEN_POLAR_PRO_PRODUCT_ID and
 * BRIVEN_POLAR_TEAM_PRODUCT_ID are the UUIDs of the Polar products that
 * correspond to each tier. Webhooks look up the tier by matching the
 * product_id from Polar's payload against these env values. Checkout calls
 * pass the same UUIDs to Polar in the `products: [...]` body.
 *
 * Webhook expected payloads (subset we care about):
 *   - subscription.created
 *   - subscription.updated (status / currentPeriodEnd changes)
 *   - subscription.canceled
 */

type CheckoutableTier = 'pro' | 'team';

export interface PlanConfig {
  tier: CheckoutableTier;
  productId: string;
}

/**
 * Plans currently configured for checkout. Returns an empty array when no
 * product UUIDs are set — the settings page reads this to decide whether
 * the upgrade buttons are live.
 */
export function configuredPlans(): PlanConfig[] {
  const out: PlanConfig[] = [];
  if (env.BRIVEN_POLAR_PRO_PRODUCT_ID) {
    out.push({ tier: 'pro', productId: env.BRIVEN_POLAR_PRO_PRODUCT_ID });
  }
  if (env.BRIVEN_POLAR_TEAM_PRODUCT_ID) {
    out.push({ tier: 'team', productId: env.BRIVEN_POLAR_TEAM_PRODUCT_ID });
  }
  return out;
}

function tierForProductId(productId: string): ProjectTier {
  if (productId === env.BRIVEN_POLAR_PRO_PRODUCT_ID) return 'pro';
  if (productId === env.BRIVEN_POLAR_TEAM_PRODUCT_ID) return 'team';
  return 'free';
}

export async function upsertSubscriptionFromPolar(input: {
  polarSubscriptionId: string;
  polarCustomerId: string;
  polarProductId: string;
  ownerId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  canceledAt: Date | null;
}): Promise<void> {
  const tier = tierForProductId(input.polarProductId);
  const db = getDb();
  await db
    .insert(subscriptions)
    .values({
      id: `sub_${input.polarSubscriptionId}`,
      ownerId: input.ownerId,
      polarSubscriptionId: input.polarSubscriptionId,
      polarCustomerId: input.polarCustomerId,
      tier,
      status: input.status,
      currentPeriodEnd: input.currentPeriodEnd,
      canceledAt: input.canceledAt,
    })
    .onConflictDoUpdate({
      target: subscriptions.polarSubscriptionId,
      set: {
        tier,
        status: input.status,
        currentPeriodEnd: input.currentPeriodEnd,
        canceledAt: input.canceledAt,
        updatedAt: new Date(),
      },
    });

  log.info('subscription_synced', {
    polarSubscriptionId: input.polarSubscriptionId,
    tier,
    status: input.status,
  });
}

export async function getTierForOwner(ownerId: string): Promise<ProjectTier> {
  const db = getDb();
  const [row] = await db
    .select({ tier: subscriptions.tier, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.ownerId, ownerId))
    .limit(1);
  if (!row) return 'free';
  if (row.status === 'canceled' || row.status === 'past_due') return 'free';
  return row.tier;
}

export interface SubscriptionSummary {
  tier: ProjectTier;
  status: SubscriptionStatus | 'free';
  currentPeriodEnd: string | null;
  canceledAt: string | null;
  polarCustomerId: string | null;
}

/**
 * Full billing snapshot for the signed-in owner. Returns a 'free' sentinel
 * when the user has never had a paid subscription. Consumers use this for
 * the settings page — `getTierForOwner` remains the cheap lookup for tier
 * enforcement.
 */
export async function getSubscriptionForOwner(ownerId: string): Promise<SubscriptionSummary> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.ownerId, ownerId))
    .limit(1);
  if (!row) {
    return {
      tier: 'free',
      status: 'free',
      currentPeriodEnd: null,
      canceledAt: null,
      polarCustomerId: null,
    };
  }
  return {
    tier:
      row.status === 'canceled' || row.status === 'past_due' ? 'free' : row.tier,
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    polarCustomerId: row.polarCustomerId,
  };
}

/**
 * Open a Polar customer portal session the user can use to manage cards,
 * invoices, and cancellation on Polar's hosted UI. Throws PolarNotConfigured
 * when the access token is missing, or NotFoundError if the user has no
 * `polar_customer_id` yet (i.e. they've never checked out).
 */
export async function createCustomerPortalSession(
  polarCustomerId: string,
  returnURL: string,
): Promise<{ url: string }> {
  if (!env.BRIVEN_POLAR_ACCESS_TOKEN) throw new PolarNotConfigured();
  const res = await fetch(`${env.BRIVEN_POLAR_API_BASE}/v1/customer-sessions/`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.BRIVEN_POLAR_ACCESS_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      customer_id: polarCustomerId,
      return_url: returnURL,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new brivenError('polar_error', `polar portal failed: ${body}`, { status: 502 });
  }
  const parsed = (await res.json()) as { customer_portal_url?: string };
  if (!parsed.customer_portal_url) {
    throw new brivenError('polar_error', 'polar did not return a portal url', { status: 502 });
  }
  return { url: parsed.customer_portal_url };
}

export class PolarNotConfigured extends brivenError {
  constructor() {
    super('polar_not_configured', 'billing is not configured', { status: 503 });
    this.name = 'PolarNotConfigured';
  }
}

export class UnknownTier extends brivenError {
  constructor(tier: string) {
    super('unknown_tier', `tier '${tier}' has no configured polar product`, { status: 400 });
    this.name = 'UnknownTier';
  }
}

/**
 * Create a Polar checkout session for the requested tier. Returns the hosted
 * checkout URL the caller can redirect to. Uses Polar's current API shape
 * (`products: [productId]`) — the deprecated `product_price_id` field is
 * not used.
 */
export async function createCheckout(input: {
  ownerId: string;
  email: string;
  tier: CheckoutableTier;
  successURL: string;
}): Promise<{ url: string }> {
  if (!env.BRIVEN_POLAR_ACCESS_TOKEN) throw new PolarNotConfigured();
  const plan = configuredPlans().find((p) => p.tier === input.tier);
  if (!plan) throw new UnknownTier(input.tier);

  const res = await fetch(`${env.BRIVEN_POLAR_API_BASE}/v1/checkouts/`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.BRIVEN_POLAR_ACCESS_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      products: [plan.productId],
      customer_email: input.email,
      success_url: input.successURL,
      metadata: { ownerId: input.ownerId, tier: input.tier },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new brivenError('polar_error', `polar checkout failed: ${body}`, { status: 502 });
  }
  return (await res.json()) as { url: string };
}
