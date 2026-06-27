/**
 * Mavi Pay (backed by Polar.sh) — the superadmin billing seam.
 *
 * Phase 3 wires REAL numbers from the control-plane `subscriptions` table,
 * which the Polar webhook keeps in sync (upsertSubscriptionFromPolar). That
 * local table — not a live Polar call — is the source of truth for who is
 * subscribed, so the cockpit renders instantly without hitting Polar on every
 * load.
 *
 * Honesty rules (unchanged from Phase 2): every number is REAL or explicitly
 * null. The web layer renders "—" for nulls rather than a fake zero. Only MRR
 * can degrade to null — it needs the per-tier monthly price, which lives on
 * the Polar products. With no Polar token / product ids configured (e.g. this
 * dev worktree) the price lookup returns null and MRR shows "—"; the counts,
 * plan mix, and churn still come back real from the local DB.
 *
 * Definitions (documented here so the cockpit and tests agree):
 *   - subscribers : COUNT of subscriptions whose status is NOT 'canceled'
 *                   (i.e. 'trialing' | 'active' | 'past_due'). These are the
 *                   org-level paid subscriptions the webhook has recorded.
 *                   Subscriptions only ever carry a paid tier (pro|team), so
 *                   this equals paidSubscribers(planMix).
 *   - planMix.pro / planMix.team : those non-canceled subscriptions grouped by
 *                   tier. (Source: subscriptions table.)
 *   - planMix.free: non-deleted projects on the free tier — the Phase-2 free
 *                   count source, kept as-is. Free users never have a
 *                   subscription row, so the free bucket comes from projects,
 *                   not subscriptions. (Source: projects table — heterogeneous
 *                   with pro/team on purpose; documented.)
 *   - churn30d    : COUNT of subscriptions with status='canceled' whose row was
 *                   last updated within the last 30 days. APPROXIMATION: keyed
 *                   off updatedAt as the "when it churned" timestamp, so a
 *                   later edit to a long-canceled row would re-count it. Good
 *                   enough for a glance; a precise churn metric would need a
 *                   dedicated cancellation-event log.
 *   - mrr         : sum over the non-canceled paid subscriptions of that tier's
 *                   monthly price, fetched from the Polar product. null when
 *                   Polar isn't configured or the fetch fails — NEVER faked.
 *   - currency    : ISO currency code of the MRR figure (from Polar), or null
 *                   when MRR is null.
 */
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import { getDb } from '../../db/client.js';
import {
  organizations,
  projects,
  projectTier,
  subscriptions,
  users,
  type ProjectTier,
  type SubscriptionStatus,
} from '../../db/schema.js';
import { env } from '../../env.js';
import { log } from '../../lib/logger.js';

export type PlanMix = Record<ProjectTier, number>;

export interface BillingTotals {
  /** Count of non-canceled subscriptions (trialing | active | past_due). */
  subscribers: number | null;
  /** Monthly recurring revenue in `currency`, or null when Polar is unconfigured / unreachable. */
  mrr: number | null;
  /** ISO currency code for `mrr`, or null when mrr is null. */
  currency: string | null;
  /** free = non-deleted free-tier projects; pro/team = non-canceled subs by tier. */
  planMix: PlanMix | null;
  /** Count of subscriptions canceled (by updatedAt) in the last 30 days. */
  churn30d: number | null;
}

/** Statuses that count as an active (non-canceled) subscription. */
export const ACTIVE_SUB_STATUSES = ['trialing', 'active', 'past_due'] as const;

/** Churn lookback window, in days. */
export const CHURN_WINDOW_DAYS = 30;

/**
 * Pure helper: paid subscribers are everything that isn't on the free tier.
 * Kept separate from the DB query so the rule is unit-testable without a
 * database. A change here without its test shows up red.
 */
export function paidSubscribers(planMix: PlanMix): number {
  return planMix.pro + planMix.team;
}

/**
 * Pure helper: assemble the plan mix from the free-tier project count plus the
 * per-tier counts of non-canceled subscriptions. Unit-testable in isolation.
 */
export function buildPlanMix(
  freeCount: number,
  activeSubsByTier: Array<{ tier: ProjectTier; count: number }>,
): PlanMix {
  const mix = Object.fromEntries(projectTier.map((t) => [t, 0])) as PlanMix;
  mix.free = freeCount;
  for (const row of activeSubsByTier) {
    if (row.tier === 'pro' || row.tier === 'team') mix[row.tier] = row.count;
  }
  return mix;
}

/**
 * Pure helper: MRR = (pro subs × pro price) + (team subs × team price). Prices
 * are per-month, in major currency units. Unit-testable without Polar or a DB.
 */
export function computeMrr(
  counts: { pro: number; team: number },
  prices: { pro: number; team: number },
): number {
  return counts.pro * prices.pro + counts.team * prices.team;
}

/**
 * Pure helper: is this subscription a churn within the window? True only when
 * the sub is canceled AND its row was last updated within `windowDays`.
 */
export function isChurnWithinWindow(
  sub: { status: SubscriptionStatus; updatedAt: Date },
  now: Date,
  windowDays: number = CHURN_WINDOW_DAYS,
): boolean {
  if (sub.status !== 'canceled') return false;
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  return sub.updatedAt.getTime() >= cutoff;
}

/** Pure helper: count churned subs within the window. */
export function countChurnWithinWindow(
  subs: Array<{ status: SubscriptionStatus; updatedAt: Date }>,
  now: Date,
  windowDays: number = CHURN_WINDOW_DAYS,
): number {
  return subs.filter((s) => isChurnWithinWindow(s, now, windowDays)).length;
}

/* ─── Polar price lookup (the only live Polar call; cached) ──────────────── */

interface TierPrices {
  pro: number;
  team: number;
  currency: string;
}

interface PriceCacheEntry {
  value: TierPrices | null;
  expiresAt: number;
}

const PRICE_CACHE_TTL_MS = 60 * 60 * 1000; // 1h — the dashboard must not hit Polar every load.
let priceCache: PriceCacheEntry | null = null;

/** Shape of the subset of the Polar product response we read. */
interface PolarProductResponse {
  prices?: Array<{
    price_amount?: number | null;
    price_currency?: string | null;
    recurring_interval?: string | null;
    is_archived?: boolean | null;
  }>;
}

/**
 * Fetch one Polar product's recurring MONTHLY price. Returns the amount in
 * major units (Polar gives cents) + ISO currency, or null on any failure /
 * missing monthly price. Callers treat null as "MRR unknown".
 */
async function fetchTierMonthlyPrice(
  productId: string,
): Promise<{ amount: number; currency: string } | null> {
  const res = await fetch(`${env.BRIVEN_POLAR_API_BASE}/v1/products/${productId}`, {
    headers: { authorization: `Bearer ${env.BRIVEN_POLAR_ACCESS_TOKEN}` },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) {
    log.warn('mavi_pay_price_fetch_failed', { productId, status: res.status });
    return null;
  }
  const data = (await res.json()) as PolarProductResponse;
  const price = (data.prices ?? []).find(
    (p) =>
      !p.is_archived &&
      p.recurring_interval === 'month' &&
      typeof p.price_amount === 'number',
  );
  if (!price || typeof price.price_amount !== 'number') return null;
  return {
    amount: price.price_amount / 100,
    currency: (price.price_currency ?? 'usd').toUpperCase(),
  };
}

/**
 * Get the pro + team monthly prices, cached in-memory for 1h. Returns null
 * (degrade gracefully) when the token / product ids aren't set or either fetch
 * fails. NEVER throws into the totals path.
 */
async function getTierMonthlyPrices(): Promise<TierPrices | null> {
  if (priceCache && priceCache.expiresAt > Date.now()) return priceCache.value;

  const value = await loadTierMonthlyPrices();
  priceCache = { value, expiresAt: Date.now() + PRICE_CACHE_TTL_MS };
  return value;
}

async function loadTierMonthlyPrices(): Promise<TierPrices | null> {
  const proId = env.BRIVEN_POLAR_PRO_PRODUCT_ID;
  const teamId = env.BRIVEN_POLAR_TEAM_PRODUCT_ID;
  // Degrade to null (UI shows "—") rather than throwing when Polar isn't wired
  // in this environment.
  if (!env.BRIVEN_POLAR_ACCESS_TOKEN || !proId || !teamId) return null;
  try {
    const [pro, team] = await Promise.all([
      fetchTierMonthlyPrice(proId),
      fetchTierMonthlyPrice(teamId),
    ]);
    if (!pro || !team) return null;
    if (pro.currency !== team.currency) {
      // Mixed-currency products can't be summed into one MRR figure honestly.
      log.warn('mavi_pay_price_currency_mismatch', {
        pro: pro.currency,
        team: team.currency,
      });
      return null;
    }
    return { pro: pro.amount, team: team.amount, currency: pro.currency };
  } catch (err) {
    log.warn('mavi_pay_price_load_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Test seam: clear the in-memory price cache. */
export function __resetPriceCacheForTests(): void {
  priceCache = null;
}

/* ─── public API ────────────────────────────────────────────────────────── */

export async function getBillingTotals(): Promise<BillingTotals> {
  const db = getDb();

  // (1) Non-canceled subscriptions grouped by tier — the real subscriber base.
  const subRows = await db
    .select({ tier: subscriptions.tier, count: sql<number>`count(*)::int` })
    .from(subscriptions)
    .where(inArray(subscriptions.status, [...ACTIVE_SUB_STATUSES]))
    .groupBy(subscriptions.tier);

  // (2) Free bucket: non-deleted projects on the free tier (Phase-2 source).
  const [freeRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(and(isNull(projects.deletedAt), eq(projects.tier, 'free')));
  const freeCount = freeRow?.count ?? 0;

  // (3) Churn: subscriptions canceled (by updatedAt) within the window.
  const since = new Date(Date.now() - CHURN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [churnRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(subscriptions)
    .where(and(eq(subscriptions.status, 'canceled'), gte(subscriptions.updatedAt, since)));
  const churn30d = churnRow?.count ?? 0;

  const planMix = buildPlanMix(freeCount, subRows);

  // (4) MRR — the only number that can degrade to null (needs Polar prices).
  const prices = await getTierMonthlyPrices();
  let mrr: number | null = null;
  let currency: string | null = null;
  if (prices) {
    mrr = computeMrr({ pro: planMix.pro, team: planMix.team }, prices);
    currency = prices.currency;
  }

  return {
    subscribers: paidSubscribers(planMix),
    mrr,
    currency,
    planMix,
    churn30d,
  };
}

export interface SubscriberRow {
  orgId: string;
  orgName: string;
  /**
   * Owner's email — operator-only triage. The cockpit is the admin's own
   * back-office (not the public site), so showing the owner email for triage
   * is allowed; the UI keeps it secondary to the org name.
   */
  ownerEmail: string | null;
  tier: ProjectTier;
  status: SubscriptionStatus;
  /** Period end / next renewal, ISO string or null. */
  currentPeriodEnd: string | null;
  /** When the subscription was first recorded (createdAt), ISO string. */
  since: string;
}

/**
 * The non-canceled subscriber list for the cockpit table — joins subscriptions
 * → organizations → owner user. Matches the `subscribers` total: only
 * non-canceled subs (trialing | active | past_due), newest first.
 */
export async function listSubscribers(): Promise<SubscriberRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      orgId: subscriptions.orgId,
      orgName: organizations.name,
      ownerEmail: users.email,
      tier: subscriptions.tier,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      since: subscriptions.createdAt,
    })
    .from(subscriptions)
    .innerJoin(organizations, eq(organizations.id, subscriptions.orgId))
    .leftJoin(users, eq(users.id, organizations.createdBy))
    .where(inArray(subscriptions.status, [...ACTIVE_SUB_STATUSES]))
    .orderBy(desc(subscriptions.createdAt));

  return rows.map((r) => ({
    orgId: r.orgId,
    orgName: r.orgName,
    ownerEmail: r.ownerEmail ?? null,
    tier: r.tier,
    status: r.status,
    currentPeriodEnd: r.currentPeriodEnd ? r.currentPeriodEnd.toISOString() : null,
    since: r.since.toISOString(),
  }));
}
