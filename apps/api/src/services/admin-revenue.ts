import { desc, inArray, isNull, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { organizations, projects, subscriptions, usageEvents } from '../db/schema.js';
import { env } from '../env.js';

/**
 * DEEP admin revenue. CONTRACT with the web revenue page. Every number comes
 * from REAL tables (subscriptions + usage_events); MRR is null until live
 * payments flow through Mavi Pay (Polar). meteredUsage + monthlyTimeline are
 * the numbers that WILL bill once the payment layer is wired — this is the
 * honest "what's about to be charged" view, not fabricated revenue.
 */
export interface AdminRevenue {
  connected: boolean;
  currency: 'EUR';
  mrr: number | null;
  planMix: { free: number; pro: number; team: number };
  activeSubscriptions: Array<{
    orgId: string;
    orgName: string | null;
    tier: string;
    status: string;
    since: string | null;
    currentPeriodEnd: string | null;
  }>;
  meteredUsage: Array<{
    metric: string;
    period: string;
    quantity: number;
    unit: string;
    pushStatus: string;
  }>;
  monthlyTimeline: Array<{ month: string; invocations: number; storageRows: number }>;
  note: string;
}

const NOTE =
  'live payment capture runs through Mavi Pay, not yet connected — these are the metered numbers that will bill once it is.';

/** Human unit label per usage metric — for the "what will bill" table. */
function unitFor(metric: string): string {
  switch (metric) {
    case 'invocations':
      return 'invocation';
    case 'storage_bytes':
      return 'byte';
    case 'connection_seconds':
      return 'second';
    case 'auth_mau':
      return 'monthly-active-user';
    case 'auth_sso_connections':
      return 'sso-connection';
    case 'auth_sso_signins':
      return 'sso-sign-in';
    default:
      return 'unit';
  }
}

/** Mavi Pay (Polar) is "connected" only when a token AND a product are set. */
function isPaymentConnected(): boolean {
  return Boolean(
    env.BRIVEN_POLAR_ACCESS_TOKEN &&
      (env.BRIVEN_POLAR_PRO_PRODUCT_ID || env.BRIVEN_POLAR_TEAM_PRODUCT_ID),
  );
}

/** Live count of non-deleted projects grouped by tier. */
async function planMixFromProjects(): Promise<{ free: number; pro: number; team: number }> {
  const db = getDb();
  const rows = await db
    .select({ tier: projects.tier, count: sql<number>`count(*)::int` })
    .from(projects)
    .where(isNull(projects.deletedAt))
    .groupBy(projects.tier);
  const mix = { free: 0, pro: 0, team: 0 };
  for (const r of rows) {
    if (r.tier === 'free' || r.tier === 'pro' || r.tier === 'team') mix[r.tier] = r.count;
  }
  return mix;
}

export async function getAdminRevenue(): Promise<AdminRevenue> {
  const db = getDb();

  // Active subscriptions (anything not canceled), joined to org name.
  const subRows = await db
    .select({
      orgId: subscriptions.orgId,
      tier: subscriptions.tier,
      status: subscriptions.status,
      since: subscriptions.createdAt,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .orderBy(desc(subscriptions.createdAt));
  const activeSubs = subRows.filter((s) => s.status !== 'canceled');

  const orgIds = [...new Set(activeSubs.map((s) => s.orgId))];
  const orgNameById = new Map<string, string>();
  if (orgIds.length > 0) {
    const orgRows = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(inArray(organizations.id, orgIds));
    for (const o of orgRows) orgNameById.set(o.id, o.name);
  }

  // Metered usage — the last 100 rows the meter-push worker tracks. This is
  // literally "what WILL bill" once Mavi Pay is connected.
  const usageRows = await db
    .select({
      metric: usageEvents.metric,
      periodStart: usageEvents.periodStart,
      value: usageEvents.value,
      pushStatus: usageEvents.polarPushStatus,
    })
    .from(usageEvents)
    .orderBy(desc(usageEvents.periodStart))
    .limit(100);

  const planMix = await planMixFromProjects();

  // MRR = active paid subscriptions × their tier's published monthly price.
  // Prices MUST match the pricing page (apps/web/.../pricing-section.tsx):
  // free €0 · pro €29 · team €99 (approved by Jürgen 2026-06-15). €0 when
  // there are no paid subs yet; null only when payments aren't connected.
  const TIER_MRR_EUR: Record<string, number> = { free: 0, pro: 29, team: 99 };
  const mrrValue = activeSubs.reduce((sum, s) => sum + (TIER_MRR_EUR[s.tier] ?? 0), 0);

  return {
    connected: isPaymentConnected(),
    currency: 'EUR',
    mrr: isPaymentConnected() ? mrrValue : null,
    planMix,
    // Null-tolerant mapping throughout: the LIVE table can predate the
    // schema's notNull constraints (migrations don't run on deploy), and one
    // legacy null must degrade to a placeholder — never crash the cockpit.
    activeSubscriptions: activeSubs.map((s) => ({
      orgId: s.orgId,
      orgName: orgNameById.get(s.orgId) ?? null,
      tier: s.tier ?? 'free',
      status: s.status ?? 'active',
      since: s.since ? s.since.toISOString() : null,
      currentPeriodEnd: s.currentPeriodEnd ? s.currentPeriodEnd.toISOString() : null,
    })),
    meteredUsage: usageRows.map((u) => ({
      metric: u.metric ?? 'unknown',
      period: u.periodStart ? u.periodStart.toISOString() : '',
      quantity: Number(u.value) || 0,
      unit: unitFor(u.metric ?? ''),
      pushStatus: u.pushStatus ?? 'pending',
    })),
    monthlyTimeline: await monthlyUsageTimeline(),
    note: NOTE,
  };
}

/**
 * usage_events grouped by month for the last 6 months, zero-filled.
 * invocations = SUM(value) for the 'invocations' metric; storageRows is the
 * latest storage sample per month (storage is a gauge, so a SUM would be
 * meaningless — we take MAX in-month as the representative figure).
 *
 * GOTCHA: raw drizzle sql`` templates CRASH on JS Date params under Bun —
 * pass .toISOString() strings + ::timestamptz casts (see function-logs.ts).
 */
async function monthlyUsageTimeline(): Promise<
  Array<{ month: string; invocations: number; storageRows: number }>
> {
  const db = getDb();
  // Start of the month 5 months ago → 6 buckets including the current month.
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCMonth(start.getUTCMonth() - 5);
  const since = start.toISOString();

  const rows = (await db.execute(sql`
    WITH months AS (
      SELECT generate_series(
        date_trunc('month', ${since}::timestamptz),
        date_trunc('month', now()),
        interval '1 month'
      ) AS month
    ),
    usage_by_month AS (
      SELECT
        date_trunc('month', period_start) AS month,
        coalesce(sum((value::numeric)) FILTER (WHERE metric = 'invocations'), 0) AS invocations,
        coalesce(max((value::numeric)) FILTER (WHERE metric = 'storage_bytes'), 0) AS storage_rows
      FROM usage_events
      WHERE period_start >= ${since}::timestamptz
      GROUP BY 1
    )
    SELECT
      months.month AS month,
      coalesce(usage_by_month.invocations, 0) AS invocations,
      coalesce(usage_by_month.storage_rows, 0) AS storage_rows
    FROM months
    LEFT JOIN usage_by_month ON usage_by_month.month = months.month
    ORDER BY months.month
  `)) as Array<{
    month: string | Date;
    invocations: number | string;
    storage_rows: number | string;
  }>;

  // Some drivers return the result rows directly, others wrap them in
  // `{ rows }` — accept both, and drop any bucket whose month won't parse
  // rather than letting toISOString() throw the whole endpoint down.
  const list = Array.isArray(rows)
    ? rows
    : ((rows as unknown as { rows?: typeof rows }).rows ?? []);
  return list.flatMap((r) => {
    const d = r.month instanceof Date ? r.month : new Date(r.month);
    if (Number.isNaN(d.getTime())) return [];
    return [
      {
        month: d.toISOString().slice(0, 7),
        invocations: Number(r.invocations) || 0,
        storageRows: Number(r.storage_rows) || 0,
      },
    ];
  });
}
