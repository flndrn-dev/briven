import { sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { getDb } from '../db/client.js';
import { env } from '../env.js';
import { requireAdmin } from '../middleware/admin.js';
import { requireAuth } from '../middleware/session.js';
import { PROM_QUERIES } from '../services/platform-health.js';
import type { AppEnv } from '../types/app-env.js';

/**
 * Admin activity timeseries — GET /v1/admin/timeseries. Feeds the cockpit
 * overview's charts with REAL platform history, never fabricated:
 *
 * - signupsDaily / deploysDaily / invocationsDaily — 30 zero-filled daily
 *   buckets straight from the control DB (users.created_at,
 *   deploy_history.booted_at, function_logs.created_at).
 * - apiRequests / hostCpu — last 24h at 5m resolution from Prometheus's
 *   range API. HARD honesty rule (same as services/platform-health.ts):
 *   when BRIVEN_PROMETHEUS_URL is unset, unreachable, or a query comes
 *   back empty, the field is null and the UI says "monitoring not
 *   connected" — a dead exporter never masquerades as a flat line.
 *
 * Guard chain mirrors routes/admin-agents.ts EXACTLY (session → admin
 * bit). Read-only, so no step-up gate — same as the GET paths there.
 */

export const adminTimeseriesRouter = new Hono<AppEnv>();

adminTimeseriesRouter.use('/v1/admin/timeseries', requireAuth());
adminTimeseriesRouter.use('/v1/admin/timeseries', requireAdmin());

/* ─── daily counts from the control DB ───────────────────────────────── */

const DAYS = 30;

export interface DailyPoint {
  /** Calendar day, 'YYYY-MM-DD'. */
  readonly day: string;
  readonly count: number;
}

/**
 * Count rows per calendar day over the last 30 days, zero-filled via
 * generate_series so the chart always has 30 stable points. Table/column
 * names come from a closed literal union (never user input) so sql.raw
 * is injection-safe here.
 */
async function dailyCounts(
  table: 'users' | 'deploy_history' | 'function_logs',
  column: 'created_at' | 'booted_at',
): Promise<DailyPoint[]> {
  const db = getDb();
  // ISO string, not Date: postgres.js can't serialize a raw Date param in
  // sql`` templates under Bun ("string argument … Received an instance of
  // Date") — the ::timestamptz cast makes the string unambiguous. Same
  // blessed pattern as services/function-logs.ts getHourlyInvocations.
  const since = new Date(Date.now() - (DAYS - 1) * 24 * 60 * 60 * 1000).toISOString();
  const rows = (await db.execute(sql`
    WITH days AS (
      SELECT generate_series(
        date_trunc('day', ${since}::timestamptz),
        date_trunc('day', now()),
        interval '1 day'
      ) AS day
    ),
    src AS (
      SELECT
        date_trunc('day', ${sql.raw(column)}) AS day,
        count(*)::int AS count
      FROM ${sql.raw(table)}
      WHERE ${sql.raw(column)} >= ${since}::timestamptz
      GROUP BY 1
    )
    SELECT
      to_char(days.day, 'YYYY-MM-DD') AS day,
      coalesce(src.count, 0) AS count
    FROM days
    LEFT JOIN src ON src.day = days.day
    ORDER BY days.day
  `)) as Array<{ day: string; count: number | string }>;
  return rows.map((r) => ({ day: r.day, count: Number(r.count) || 0 }));
}

/* ─── prometheus range queries (24h · 5m step) ───────────────────────── */

// The api's real request counter — middleware/metrics.ts increments
// `http_requests_total{method,status,route}` per request (lib/metrics.ts).
// rate() is per-second, so ×60 yields requests per minute.
const API_REQUESTS_PER_MIN = 'sum(rate(http_requests_total[5m])) * 60';

interface RangePoint {
  /** Sample timestamp, ISO 8601. */
  readonly t: string;
  readonly value: number;
}

/**
 * Pure parser for a Prometheus range-query (`/api/v1/query_range`)
 * matrix response — the range twin of platform-health's parsePromSample.
 * Returns the FIRST series' samples, or null for any non-success status,
 * empty result, or unparseable payload. Never throws, never fabricates.
 */
function parsePromMatrix(json: unknown): RangePoint[] | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as { status?: unknown; data?: unknown };
  if (root.status !== 'success' || !root.data || typeof root.data !== 'object') {
    return null;
  }
  const result = (root.data as { result?: unknown }).result;
  if (!Array.isArray(result) || result.length === 0) return null;
  const first = result[0] as { values?: unknown };
  if (!Array.isArray(first.values) || first.values.length === 0) return null;
  const points: RangePoint[] = [];
  for (const pair of first.values) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const ts = Number(pair[0]);
    const num = typeof pair[1] === 'number' ? pair[1] : Number.parseFloat(String(pair[1]));
    if (!Number.isFinite(ts) || !Number.isFinite(num)) continue;
    points.push({ t: new Date(ts * 1000).toISOString(), value: num });
  }
  return points.length > 0 ? points : null;
}

/**
 * One PromQL expression against the range API — last 24h, 5m step.
 * Mirrors platform-health's queryProm: any failure (network, timeout,
 * non-2xx, bad JSON, empty matrix) collapses to null so one dead metric
 * never poisons the other.
 */
async function queryPromRange(base: string, query: string): Promise<RangePoint[] | null> {
  try {
    const end = Math.floor(Date.now() / 1000);
    const start = end - 24 * 60 * 60;
    const url =
      `${base}/api/v1/query_range?query=${encodeURIComponent(query)}` +
      `&start=${start}&end=${end}&step=300`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return parsePromMatrix(await res.json());
  } catch {
    return null;
  }
}

/** Round to `digits` decimals; keeps the JSON payload compact. */
function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

async function getPromSeries(): Promise<{
  apiRequests: Array<{ t: string; perMin: number }> | null;
  hostCpu: Array<{ t: string; pct: number }> | null;
}> {
  const base = env.BRIVEN_PROMETHEUS_URL;
  if (!base) return { apiRequests: null, hostCpu: null };
  const [req, cpu] = await Promise.all([
    queryPromRange(base, API_REQUESTS_PER_MIN),
    // Same expression platform-health uses for the instant host cpu%.
    queryPromRange(base, PROM_QUERIES.cpuPercent),
  ]);
  return {
    apiRequests: req ? req.map((p) => ({ t: p.t, perMin: round(p.value, 2) })) : null,
    hostCpu: cpu ? cpu.map((p) => ({ t: p.t, pct: round(p.value, 1) })) : null,
  };
}

/* ─── route ──────────────────────────────────────────────────────────── */

adminTimeseriesRouter.get('/v1/admin/timeseries', async (c) => {
  const [signupsDaily, deploysDaily, invocationsDaily, prom] = await Promise.all([
    dailyCounts('users', 'created_at'),
    dailyCounts('deploy_history', 'booted_at'),
    // Platform-wide invocation volume — deliberately no project filter.
    dailyCounts('function_logs', 'created_at'),
    getPromSeries(),
  ]);
  return c.json({
    signupsDaily,
    deploysDaily,
    invocationsDaily,
    apiRequests: prom.apiRequests,
    hostCpu: prom.hostCpu,
  });
});
