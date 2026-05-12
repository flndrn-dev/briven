import { and, eq, gte, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { auditLogs, projects } from '../db/schema.js';
import { log } from '../lib/logger.js';
import { audit } from './audit.js';

/**
 * SLA enforcement — Phase 4 launch-readiness.
 *
 * briven surfaces per-tier SLA targets on the billing page (Pro 99.5%,
 * Team 99.9%). For year-one + private-beta these are operational
 * commitments — uptime tracked, customers informed — but no auto-credit
 * fires when a breach happens. This service is the auto-credit half.
 *
 * Architecture:
 * 1. Uptime is measured per service per minute (alertmanager source of
 *    truth). For now we infer breaches from a simple model: count the
 *    number of seconds the api was unreachable in a billing period.
 * 2. Each billing period (calendar month UTC) we compute uptime% =
 *    1 - (downtime_seconds / period_seconds).
 * 3. If uptime% < tier.slaTargetUptime, we issue an auto-credit equal
 *    to a percentage of the monthly subscription fee (per the
 *    breach severity matrix below).
 * 4. The credit lands as a one-time discount on the next Polar invoice;
 *    we POST to Polar's billing-credit endpoint when it lands. Until
 *    then we just write an audit_log row marking the intent.
 *
 * Today this service exposes the math + the audit-log writer. The
 * downtime-seconds source (alertmanager → durable file) is the next
 * piece to wire; until then `recordedDowntimeSeconds()` returns 0 and
 * no breaches fire.
 */

export interface SlaTier {
  /** 0-1. e.g. 0.995 means 99.5%. */
  readonly targetUptime: number;
  /** Max downtime allowed in a calendar month (seconds). Derived from
   * targetUptime × month length. */
  readonly maxMonthlyDowntimeSeconds: number;
}

/**
 * Per-tier SLA targets. Numbers match the dashboard /billing surface;
 * free tier is best-effort (no SLA target, no credit ever fires).
 */
export const SLA_TIERS: Record<'free' | 'pro' | 'team', SlaTier | null> = {
  free: null,
  pro: {
    targetUptime: 0.995,
    // 30 days × 86400 s = 2,592,000 s. 0.5% downtime = 12,960 s ≈ 3h 36m.
    maxMonthlyDowntimeSeconds: Math.floor((1 - 0.995) * 30 * 86400),
  },
  team: {
    targetUptime: 0.999,
    // 30 days × 86400 s = 2,592,000 s. 0.1% downtime = 2,592 s ≈ 43m.
    maxMonthlyDowntimeSeconds: Math.floor((1 - 0.999) * 30 * 86400),
  },
};

/**
 * Severity-graded credit. Worse breaches return more.
 *
 *   target uptime − actual uptime ratio →
 *     ≤ 0.5% over the breach point: 10% credit
 *     0.5% – 1%: 25% credit
 *     1% – 5%: 50% credit
 *     > 5%: 100% credit (full month free)
 *
 * Numbers anchor to the Convex / Vercel / Render published SLAs.
 * Confirm with billing-side legal before publishing publicly.
 */
export function creditPercentForBreach(target: number, actual: number): number {
  if (actual >= target) return 0;
  const delta = target - actual;
  if (delta <= 0.005) return 0.1;
  if (delta <= 0.01) return 0.25;
  if (delta <= 0.05) return 0.5;
  return 1.0;
}

export interface UptimeReport {
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly downtimeSeconds: number;
  readonly uptimeRatio: number;
}

/**
 * Compute uptime for a given period from the durable downtime source.
 * Today the source is a stub returning 0 — wire alertmanager's
 * persistent `incidents.ts` file as the source of truth once the
 * writer ships (see docs/runbooks/discord-setup.md §4).
 */
export async function uptimeForPeriod(
  periodStart: Date,
  periodEnd: Date,
): Promise<UptimeReport> {
  const downtimeSeconds = await recordedDowntimeSeconds(periodStart, periodEnd);
  const totalSeconds = Math.max(1, Math.floor((periodEnd.getTime() - periodStart.getTime()) / 1000));
  return {
    periodStart,
    periodEnd,
    downtimeSeconds,
    uptimeRatio: 1 - downtimeSeconds / totalSeconds,
  };
}

/**
 * Stub today. When the alertmanager → incidents.ts writer ships, this
 * reads from the persistent file: sum `(resolvedAt - startedAt)` over
 * every incident with severity in ('critical', 'major') in the period.
 */
async function recordedDowntimeSeconds(
  _periodStart: Date,
  _periodEnd: Date,
): Promise<number> {
  // Intentional 0 until the writer is in place. Uptime always reports
  // 100% — no false breach fires before we have a real signal.
  return 0;
}

export interface BreachOutcome {
  readonly projectId: string;
  readonly tier: 'pro' | 'team';
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly uptimeRatio: number;
  readonly targetUptime: number;
  readonly creditPercent: number;
}

/**
 * For each project on a paid tier, check the previous calendar month's
 * uptime. If it fell below the tier target, write an audit row marking
 * the breach + the credit %, and return the entries the operator can
 * push to Polar as one-time discounts.
 *
 * Idempotent via the audit log — re-running for an already-evaluated
 * period is a no-op (the row already exists).
 */
export async function evaluateBreachesForPeriod(
  periodStart: Date,
  periodEnd: Date,
): Promise<readonly BreachOutcome[]> {
  const report = await uptimeForPeriod(periodStart, periodEnd);
  // Fast path: if uptime is at the highest target, no project breached.
  if (report.uptimeRatio >= 0.999) return [];

  const db = getDb();
  const paidProjects = (await db
    .select({ id: projects.id, tier: projects.tier })
    .from(projects)
    .where(sql`${projects.tier} <> 'free' AND ${projects.deletedAt} IS NULL`)) as {
    id: string;
    tier: 'pro' | 'team';
  }[];

  const outcomes: BreachOutcome[] = [];
  for (const p of paidProjects) {
    const sla = SLA_TIERS[p.tier];
    if (!sla) continue;
    const creditPercent = creditPercentForBreach(sla.targetUptime, report.uptimeRatio);
    if (creditPercent === 0) continue;

    // Audit-log the breach. Idempotency: the (action, project, period)
    // triple is unique per breach decision; a second call for the same
    // period inserts a duplicate row only if the data changed.
    const existed = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'sla.breach.evaluated'),
          eq(auditLogs.projectId, p.id),
          gte(auditLogs.createdAt, periodStart),
        ),
      )
      .limit(1);
    if (existed.length > 0) continue;

    await audit({
      action: 'sla.breach.evaluated',
      actorId: null,
      projectId: p.id,
      ipHash: null,
      userAgent: null,
      metadata: {
        tier: p.tier,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        downtimeSeconds: report.downtimeSeconds,
        uptimeRatio: report.uptimeRatio,
        targetUptime: sla.targetUptime,
        creditPercent,
      },
    });

    outcomes.push({
      projectId: p.id,
      tier: p.tier,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      uptimeRatio: report.uptimeRatio,
      targetUptime: sla.targetUptime,
      creditPercent,
    });
  }

  if (outcomes.length > 0) {
    log.warn('sla_breach_evaluated', {
      period: periodStart.toISOString(),
      projectsCredited: outcomes.length,
      uptimeRatio: report.uptimeRatio,
    });
  }
  return outcomes;
}

/**
 * Operator entrypoint — sum the credit value across all breaches for
 * the previous calendar month. Returns the entries to push to Polar
 * manually OR (when the polar-credit-push worker ships) to drain
 * automatically. For now this is a read-only summary; operator runs
 * it from the admin dashboard and reaches out to affected customers.
 */
export function previousMonthBounds(now: Date = new Date()): { start: Date; end: Date } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0));
  return { start, end };
}

export function tierMonthlyFee(tier: 'pro' | 'team'): number {
  // Placeholder figures — actual fees live on the Polar product
  // configuration. This is here only to size the credit estimate the
  // operator sees in the admin UI. When the polar-credit-push worker
  // ships, swap this for a `fetchPolarSubscriptionAmount(orgId)` call.
  if (tier === 'pro') return 20;
  if (tier === 'team') return 200;
  return 0;
}
