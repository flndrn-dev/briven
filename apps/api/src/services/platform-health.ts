/**
 * Platform health summary — the single source of truth for the four
 * upstream readiness checks. Both /ready (apps/api) and the superadmin
 * Overview consume this so the two can never disagree about what
 * "healthy" means.
 *
 * `host` (CPU / RAM / disk) comes from the Phase 4 observability stack:
 * node-exporter scraped by Prometheus, queried here via the instant API.
 * HARD honesty rule — if Prometheus is unset/unreachable, or an
 * individual query returns no data, that field is null and the UI shows
 * "—". We NEVER fabricate a number so a dead exporter can't masquerade
 * as a healthy 0%.
 */
import { pingDb } from '../db/client.js';
import { pingDataPlane } from '../db/data-plane.js';
import { env } from '../env.js';
import { pingRedis } from '../lib/redis.js';

export type HealthCheck = 'ok' | 'unreachable' | 'not_configured';

export interface HealthChecks {
  control_postgres: HealthCheck;
  data_plane_postgres: HealthCheck;
  runtime: HealthCheck;
  realtime: HealthCheck;
  redis: HealthCheck;
}

/**
 * Real host metrics for the primary server, sourced from node-exporter
 * via Prometheus. Each numeric field is independently nullable: a single
 * failed/empty query degrades only that field, not the whole object.
 *
 * Multi-host: the prometheus.yml `node` job scrapes one node-exporter
 * target today, so this is a single-host summary. If the deploy grows to
 * multiple hosts, the non-aggregated queries (memory) return one series
 * per host and we report the FIRST (primary) — see parsePromSample. The
 * `instance` label surfaces which host the numbers belong to.
 */
export interface HostMetrics {
  cpuPercent: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  diskPercent: number | null;
  stealPercent: number | null;
  instance?: string;
}

export interface HealthSummary {
  checks: HealthChecks;
  /** Real host metrics, or null when Prometheus is unset/unreachable. */
  host: HostMetrics | null;
}

/**
 * The PromQL behind each host metric. Kept as data (not inlined) so the
 * queries are auditable in one place and reusable in tests. Mountpoint
 * "/" matches node-exporter's default root filesystem label.
 */
export const PROM_QUERIES = {
  cpuPercent: '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
  memTotalBytes: 'node_memory_MemTotal_bytes',
  memAvailableBytes: 'node_memory_MemAvailable_bytes',
  diskPercent:
    '100 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"} * 100)',
  stealPercent: 'avg(rate(node_cpu_seconds_total{mode="steal"}[5m])) * 100',
} as const;

/** One sample from a Prometheus instant-query vector result. */
export interface PromSample {
  value: number | null;
  instance?: string;
}

/**
 * Pure parser for a Prometheus instant-query (`/api/v1/query`) response.
 * Returns the FIRST series' value as a finite number, plus its `instance`
 * label when present. Returns `{ value: null }` for any non-success
 * status, empty result, or unparseable value — never throws, never
 * fabricates. Exported so the parse logic is unit-tested in isolation.
 */
export function parsePromSample(json: unknown): PromSample {
  if (!json || typeof json !== 'object') return { value: null };
  const root = json as { status?: unknown; data?: unknown };
  if (root.status !== 'success' || !root.data || typeof root.data !== 'object') {
    return { value: null };
  }
  const result = (root.data as { result?: unknown }).result;
  if (!Array.isArray(result) || result.length === 0) return { value: null };
  const first = result[0] as { value?: unknown; metric?: unknown };
  if (!Array.isArray(first.value) || first.value.length < 2) return { value: null };
  const raw = first.value[1];
  const num = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(num)) return { value: null };
  const instance =
    first.metric && typeof first.metric === 'object'
      ? (first.metric as Record<string, unknown>).instance
      : undefined;
  return {
    value: num,
    ...(typeof instance === 'string' ? { instance } : {}),
  };
}

/** Round a nullable percent to one decimal; null stays null. */
function round1(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10) / 10;
}

// In-memory cache so the cockpit (and /ready, which shares getHealthSummary)
// can't hammer Prometheus on every page load. 15s is well under the
// dashboard's natural refresh cadence yet fresh enough to be useful.
const HOST_METRICS_TTL_MS = 15_000;
let hostCache: { at: number; value: HostMetrics | null } | null = null;

/**
 * Query a single PromQL expression against the instant API. Any
 * failure (network, timeout, non-2xx, bad JSON, empty result) collapses
 * to `{ value: null }` so one dead metric never poisons the others.
 */
async function queryProm(base: string, query: string): Promise<PromSample> {
  try {
    const url = `${base}/api/v1/query?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { value: null };
    return parsePromSample(await res.json());
  } catch {
    return { value: null };
  }
}

/**
 * Real host metrics from Prometheus, or null when monitoring isn't
 * connected. Guarded so it's a no-op (and the UI honest) until an
 * operator sets BRIVEN_PROMETHEUS_URL — which keeps /ready + the health
 * route tests green with zero observability stack in dev/CI.
 */
export async function getHostMetrics(): Promise<HostMetrics | null> {
  if (!env.BRIVEN_PROMETHEUS_URL) return null;

  const now = Date.now();
  if (hostCache && now - hostCache.at < HOST_METRICS_TTL_MS) {
    return hostCache.value;
  }

  try {
    const base = env.BRIVEN_PROMETHEUS_URL;
    const [cpu, memTotal, memAvail, disk, steal] = await Promise.all([
      queryProm(base, PROM_QUERIES.cpuPercent),
      queryProm(base, PROM_QUERIES.memTotalBytes),
      queryProm(base, PROM_QUERIES.memAvailableBytes),
      queryProm(base, PROM_QUERIES.diskPercent),
      queryProm(base, PROM_QUERIES.stealPercent),
    ]);

    const memUsedBytes =
      memTotal.value !== null && memAvail.value !== null
        ? memTotal.value - memAvail.value
        : null;

    // If every query came back empty, Prometheus is reachable but has no
    // host data (e.g. node-exporter down) — report null, not a row of "—".
    const allNull =
      cpu.value === null &&
      memTotal.value === null &&
      memAvail.value === null &&
      disk.value === null &&
      steal.value === null;

    const value: HostMetrics | null = allNull
      ? null
      : {
          cpuPercent: round1(cpu.value),
          memUsedBytes,
          memTotalBytes: memTotal.value,
          diskPercent: round1(disk.value),
          stealPercent: round1(steal.value),
          // memTotal is a non-aggregated series so it carries the host's
          // instance label; the aggregated cpu/steal queries don't.
          ...(memTotal.instance ? { instance: memTotal.instance } : {}),
        };

    hostCache = { at: now, value };
    return value;
  } catch {
    hostCache = { at: now, value: null };
    return null;
  }
}

async function probeRuntime(): Promise<boolean> {
  if (!env.BRIVEN_RUNTIME_URL) return false;
  try {
    const res = await fetch(`${env.BRIVEN_RUNTIME_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Mirrors probeRuntime exactly: a 2s liveness fetch to realtime's
// /health, collapsing any failure to false so a realtime outage degrades
// /ready the same way a runtime outage does.
async function probeRealtime(): Promise<boolean> {
  if (!env.BRIVEN_REALTIME_URL) return false;
  try {
    const res = await fetch(`${env.BRIVEN_REALTIME_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getHealthSummary(): Promise<HealthSummary> {
  const [controlOk, dataOk, runtimeOk, realtimeOk, redisOk, host] = await Promise.all([
    env.BRIVEN_DATABASE_URL ? pingDb() : Promise.resolve(false),
    env.BRIVEN_DATA_PLANE_URL ? pingDataPlane() : Promise.resolve(false),
    probeRuntime(),
    probeRealtime(),
    env.BRIVEN_REDIS_URL ? pingRedis() : Promise.resolve(false),
    // null fast when Prometheus is unset; cached ~15s otherwise. /ready
    // ignores host, so this never affects the readiness verdict.
    getHostMetrics(),
  ]);

  const checks: HealthChecks = {
    control_postgres: env.BRIVEN_DATABASE_URL
      ? controlOk
        ? 'ok'
        : 'unreachable'
      : 'not_configured',
    data_plane_postgres: env.BRIVEN_DATA_PLANE_URL
      ? dataOk
        ? 'ok'
        : 'unreachable'
      : 'not_configured',
    runtime: runtimeOk ? 'ok' : 'unreachable',
    realtime: realtimeOk ? 'ok' : 'unreachable',
    redis: env.BRIVEN_REDIS_URL ? (redisOk ? 'ok' : 'unreachable') : 'not_configured',
  };

  return { checks, host };
}

/**
 * Derives the /ready boolean from the checks. Redis powers logs streaming
 * + rate limits — required only when configured; unconfigured = dev mode
 * where logs/limits silently no-op.
 */
export function isReady(checks: HealthChecks): boolean {
  return (
    checks.control_postgres === 'ok' &&
    checks.data_plane_postgres === 'ok' &&
    checks.runtime === 'ok' &&
    checks.realtime === 'ok' &&
    (checks.redis === 'ok' || checks.redis === 'not_configured')
  );
}
