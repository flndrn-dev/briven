/**
 * Status-page incident feed. The status page (server component) and the
 * RSS route (server route handler) both call `fetchIncidents()` at
 * request time and degrade to an empty list when the API is unreachable
 * — the alternative is the status page itself going down while the
 * operator is trying to publish an incident about the API being down.
 *
 * The source of truth is the `incidents` table on the api, written by
 * admins via /dashboard/admin/incidents (step-up gated). Drizzle
 * serializes `started_at`/`resolved_at` to ISO strings over JSON.
 */

const API_ORIGIN = process.env.BRIVEN_API_ORIGIN ?? 'https://api.briven.tech';
const FETCH_TIMEOUT_MS = 3000;

export interface IncidentEntry {
  readonly id: string;
  readonly startedAt: string;
  readonly resolvedAt: string | null;
  readonly severity: 'critical' | 'major' | 'minor' | 'maintenance';
  readonly services: readonly string[];
  readonly summary: string;
  readonly postmortem: string;
}

interface FetchOpts {
  activeOnly?: boolean;
  limit?: number;
  /** Skip the 30s server cache. The /status page passes true so the
   *  incident list is always fresh; the docs-shell banner leaves it
   *  false to avoid a fetch on every docs page render. */
  fresh?: boolean;
}

export async function fetchIncidents(opts: FetchOpts = {}): Promise<readonly IncidentEntry[]> {
  const params = new URLSearchParams();
  if (opts.activeOnly) params.set('active', 'true');
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const url = `${API_ORIGIN}/v1/status/incidents${qs ? `?${qs}` : ''}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
      ...(opts.fresh
        ? { cache: 'no-store' as const }
        : { next: { revalidate: 30, tags: ['incidents'] } }),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { incidents?: unknown };
    if (!Array.isArray(body.incidents)) return [];
    return body.incidents.map(normalize).filter((x): x is IncidentEntry => x !== null);
  } catch {
    return [];
  }
}

export function isOngoing(inc: IncidentEntry): boolean {
  return inc.resolvedAt === null;
}

function normalize(raw: unknown): IncidentEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : null;
  const startedAt = toIso(r.startedAt);
  const severity = r.severity;
  const services = Array.isArray(r.services) ? r.services.filter((s) => typeof s === 'string') : null;
  const summary = typeof r.summary === 'string' ? r.summary : null;
  if (!id || !startedAt || !services || !summary) return null;
  if (severity !== 'critical' && severity !== 'major' && severity !== 'minor' && severity !== 'maintenance') {
    return null;
  }
  return {
    id,
    startedAt,
    resolvedAt: toIso(r.resolvedAt),
    severity,
    services: services as string[],
    summary,
    postmortem: typeof r.postmortem === 'string' ? r.postmortem : '',
  };
}

function toIso(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
