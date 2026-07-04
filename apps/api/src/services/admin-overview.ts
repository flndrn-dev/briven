import { isNull, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { projects } from '../db/schema.js';
import { adminStats } from './admin.js';
import { listDeploys } from './deploy-history.js';
import { listIncidents } from './incidents.js';
import { getHealthSummary, type HealthSummary } from './platform-health.js';

/**
 * The admin landing overview payload. This is a CONTRACT with
 * apps/web/(admin)/admin/overview-client.tsx (the `Overview` type). Every
 * number here is REAL or an honest null:
 *   - billing subscribers/mrr/currency/planMix.churn are null while Mavi Pay
 *     is not connected. planMix (free/pro/team) IS real — a live count of
 *     projects grouped by tier.
 *   - health is getHealthSummary() (checks + host).
 *   - openIncidents counts active (unresolved) incidents.
 *   - recentDeploys is the deploy-history table, last 8 across services.
 *   - counts.projects/users from adminStats().
 */
export interface AdminOverview {
  billing: {
    subscribers: number | null;
    mrr: number | null;
    currency: string | null;
    planMix: { free: number; pro: number; team: number } | null;
    churn30d: number | null;
  };
  health: HealthSummary;
  openIncidents: number;
  recentDeploys: Array<{
    id: string;
    service: string;
    buildSha: string;
    buildAt: string | null;
    env: string;
    bootedAt: string;
  }>;
  counts: { projects: number; users: number };
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
    if (r.tier === 'free' || r.tier === 'pro' || r.tier === 'team') {
      mix[r.tier] = r.count;
    }
  }
  return mix;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const [planMix, health, activeIncidents, deploys, stats] = await Promise.all([
    planMixFromProjects(),
    getHealthSummary(),
    listIncidents({ activeOnly: true, limit: 200 }),
    listDeploys({ limit: 8 }),
    adminStats(),
  ]);

  return {
    billing: {
      // Mavi Pay is not connected — no subscriber/MRR/churn source yet. Honest
      // nulls rather than fabricated revenue. planMix is the one real signal.
      subscribers: null,
      mrr: null,
      currency: null,
      planMix,
      churn30d: null,
    },
    health,
    openIncidents: activeIncidents.length,
    recentDeploys: deploys.map((d) => ({
      id: d.id,
      service: d.service,
      buildSha: d.buildSha,
      buildAt: d.buildAt,
      env: d.env,
      bootedAt: d.bootedAt.toISOString(),
    })),
    counts: { projects: stats.projects, users: stats.users },
  };
}
