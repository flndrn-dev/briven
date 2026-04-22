import { brivenError } from '@briven/shared';
import { eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { subscriptions, type SubscriptionStatus } from '../db/schema.js';
import { env } from '../env.js';
import { log } from '../lib/logger.js';
import type { ProjectTier } from '../db/schema.js';

/**
 * Polar.sh integration skeleton.
 *
 * Status: the data model (subscriptions table) and webhook dispatcher are
 * ready, but no Polar product/price is created yet — the user flips from
 * 'free' to 'pro' by editing the subscriptions row manually. Wiring up
 * the Polar API happens when BRIVEN_POLAR_ACCESS_TOKEN is set.
 *
 * Webhook expected payloads (subset we care about):
 *   - subscription.created
 *   - subscription.updated (status / currentPeriodEnd changes)
 *   - subscription.canceled
 */

const TIER_BY_POLAR_PRODUCT: Record<string, ProjectTier> = {
  // Fill once the Polar product ids exist. Keys = Polar product ids.
  // e.g. 'prod_briven_pro': 'pro'
};

export async function upsertSubscriptionFromPolar(input: {
  polarSubscriptionId: string;
  polarCustomerId: string;
  polarProductId: string;
  ownerId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  canceledAt: Date | null;
}): Promise<void> {
  const tier = TIER_BY_POLAR_PRODUCT[input.polarProductId] ?? 'free';
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

export class PolarNotConfigured extends brivenError {
  constructor() {
    super('polar_not_configured', 'billing is not configured', { status: 503 });
    this.name = 'PolarNotConfigured';
  }
}

/** Hit Polar.sh to create a checkout session. Throws if creds missing. */
export async function createCheckout(input: {
  ownerId: string;
  email: string;
  priceId: string;
  successURL: string;
}): Promise<{ url: string }> {
  if (!env.BRIVEN_POLAR_ACCESS_TOKEN) throw new PolarNotConfigured();
  const res = await fetch('https://api.polar.sh/v1/checkouts/', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.BRIVEN_POLAR_ACCESS_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      product_price_id: input.priceId,
      customer_email: input.email,
      success_url: input.successURL,
      metadata: { ownerId: input.ownerId },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new brivenError('polar_error', `polar checkout failed: ${body}`, { status: 502 });
  }
  return (await res.json()) as { url: string };
}
