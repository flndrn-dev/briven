/**
 * Hand-curated incident history for the status page. Each entry covers
 * one operator-acknowledged event — outage, degraded performance, planned
 * maintenance. When the alertmanager → discord pipeline grows a writer
 * that persists incidents to disk, this becomes the source of truth for
 * both the html status page and the rss feed at /api/status/incidents.xml.
 *
 * Schema is intentionally minimal — we'd rather have a hand-curated
 * narrative than an auto-generated noise stream. An entry stays even
 * after resolution.
 */

export interface IncidentEntry {
  /** Stable id — append-only. Format: inc_yyyymmdd_<n>. */
  readonly id: string;
  /** When the incident started (operator's best estimate, ISO 8601 UTC). */
  readonly startedAt: string;
  /** When the operator declared it resolved. Null while ongoing. */
  readonly resolvedAt: string | null;
  /** Severity. critical = customer-impacting outage. major = degraded path. minor = something noticed and fixed before customers noticed. */
  readonly severity: 'critical' | 'major' | 'minor' | 'maintenance';
  /** Affected services — `api`, `realtime`, `runtime`, `web`, `docs`, or `all`. */
  readonly services: readonly string[];
  /** Operator-written summary. ~1-2 sentences. honest framing. */
  readonly summary: string;
  /** Operator-written postmortem (markdown). Empty string until written. */
  readonly postmortem: string;
}

export const INCIDENTS: readonly IncidentEntry[] = [
  // Append new entries to the TOP. The page renders newest-first.
  //
  // Example:
  // {
  //   id: 'inc_20260512_1',
  //   startedAt: '2026-05-12T14:00:00Z',
  //   resolvedAt: '2026-05-12T14:30:00Z',
  //   severity: 'minor',
  //   services: ['api'],
  //   summary: 'api dropped to 503 for ~5 min during a rebuild — dokploy auto-recovered.',
  //   postmortem: 'transient. no action needed. logging this so the feed has a real entry to test against.',
  // },
];

/** True when the incident has no `resolvedAt` timestamp. */
export function isOngoing(inc: IncidentEntry): boolean {
  return inc.resolvedAt === null;
}

/** Sort newest-first (by startedAt). */
export function sortedIncidents(): readonly IncidentEntry[] {
  return [...INCIDENTS].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
