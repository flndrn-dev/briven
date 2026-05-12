import { env } from '../env.js';
import { log } from '../lib/logger.js';

/**
 * Scrape briven_realtime_connection_seconds_total{project=...} from the
 * realtime service's /metrics endpoint and compute the delta vs the
 * previous scrape, per project. The cumulative counter resets when the
 * realtime process restarts; we detect that case (current < previous)
 * and treat the new value as the delta from zero so a restart costs at
 * most one scrape window of data.
 *
 * State lives in this module — `Map<projectId, lastTotalSeconds>` — so
 * a fresh api boot loses one hour of connection-seconds data for every
 * project that was active across the restart. That's the same blast
 * radius as the realtime side resetting and acceptable at Phase 3
 * scale; the durable fix is a `scraper_state` row but it's not worth
 * the table churn until customer count justifies it.
 *
 * Authenticates with BRIVEN_RUNTIME_SHARED_SECRET — the realtime
 * service refuses every other path without it (apps/realtime/src/
 * index.ts), but /metrics is open today for Prometheus scrape access.
 * Leaving the auth header in anyway so a future lockdown of /metrics
 * doesn't break this scraper silently.
 */

const lastTotalByProject = new Map<string, number>();

/** Visible for tests — pin the parser shape, not the I/O. */
export function parseConnectionSecondsMetrics(promBody: string): Map<string, number> {
  const out = new Map<string, number>();
  const lines = promBody.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (!line.startsWith('briven_realtime_connection_seconds_total')) continue;

    // Format: briven_realtime_connection_seconds_total{project="p_..."} 1234.56
    const lbraceIdx = line.indexOf('{');
    const rbraceIdx = line.indexOf('}');
    if (lbraceIdx === -1 || rbraceIdx === -1 || rbraceIdx < lbraceIdx) continue;

    const labelBody = line.slice(lbraceIdx + 1, rbraceIdx);
    const projectMatch = labelBody.match(/project="([^"]+)"/);
    if (!projectMatch) continue;
    const projectId = projectMatch[1] ?? '';
    if (!projectId) continue;

    const valueStr = line.slice(rbraceIdx + 1).trim().split(/\s+/)[0] ?? '';
    const value = Number.parseFloat(valueStr);
    if (!Number.isFinite(value) || value < 0) continue;

    out.set(projectId, value);
  }
  return out;
}

/**
 * Fetch /metrics from realtime and parse the connection_seconds gauge.
 * Returns an empty map on any failure — callers treat it as "no data
 * this tick" and skip writing rows rather than zeroing valid history.
 */
export async function scrapeConnectionSecondsTotals(): Promise<Map<string, number>> {
  if (!env.BRIVEN_REALTIME_URL) return new Map();
  try {
    const res = await fetch(`${env.BRIVEN_REALTIME_URL}/metrics`, {
      headers: env.BRIVEN_RUNTIME_SHARED_SECRET
        ? { authorization: `Bearer ${env.BRIVEN_RUNTIME_SHARED_SECRET}` }
        : {},
    });
    if (!res.ok) {
      log.warn('connection_seconds_scrape_http', {
        status: res.status,
        url: env.BRIVEN_REALTIME_URL,
      });
      return new Map();
    }
    const body = await res.text();
    return parseConnectionSecondsMetrics(body);
  } catch (err) {
    log.warn('connection_seconds_scrape_failed', {
      url: env.BRIVEN_REALTIME_URL,
      message: err instanceof Error ? err.message : String(err),
    });
    return new Map();
  }
}

/**
 * Compute the delta (in seconds) since the last call, per project. Mutates
 * the in-memory baseline so successive calls see only the increment.
 * Visible for tests so the restart-detection branch is pinned.
 */
export function diffConnectionSeconds(currentTotals: Map<string, number>): Map<string, number> {
  const deltas = new Map<string, number>();
  for (const [projectId, current] of currentTotals) {
    const previous = lastTotalByProject.get(projectId);
    let delta: number;
    if (previous === undefined) {
      // First scrape after boot — treat the current value as the
      // baseline. Writing it would over-count seconds that happened
      // before the api booted; skip this round and start measuring
      // from the next scrape.
      delta = 0;
    } else if (current < previous) {
      // Counter went backwards — realtime restarted. The "current"
      // value is the seconds accumulated since that restart; treat
      // it as the delta.
      delta = current;
    } else {
      delta = current - previous;
    }
    lastTotalByProject.set(projectId, current);
    if (delta > 0) deltas.set(projectId, delta);
  }
  return deltas;
}

/** Test-only — reset the in-memory baseline. */
export function _resetConnectionSecondsBaseline(): void {
  lastTotalByProject.clear();
}

/**
 * One-shot helper — scrape + diff. The aggregator calls this each hour
 * and writes the deltas to usage_events for the just-ended hour.
 */
export async function collectConnectionSecondsDeltas(): Promise<Map<string, number>> {
  const totals = await scrapeConnectionSecondsTotals();
  return diffConnectionSeconds(totals);
}
