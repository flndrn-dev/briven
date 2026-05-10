import { newId } from '@briven/shared';
import { desc, like } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { auditLogs } from '../db/schema.js';
import { audit } from './audit.js';

/**
 * Phase 3 abuse-report pipeline (slice).
 *
 * Reports are persisted as `audit_logs` rows with a reserved `action`
 * namespace — the dedicated `abuse_reports` table is gated on drizzle-kit
 * unblock (TODO §cross-cutting). Each report has its own ULID `reportId`
 * threaded through the metadata so the lifecycle (created → triaged →
 * resolved) joins on a single id even though multiple rows are written.
 *
 * Action namespace:
 * - `abuse.report.created` — initial submission. metadata.reportId set;
 *   metadata.{targetUrl, reason, severity, reporterContact?} carry the
 *   report content. actorId is null (public endpoint, anonymous).
 * - `abuse.report.triaged` — admin acknowledged. metadata.{reportId,
 *   triagerId, notes?}.
 * - `abuse.report.resolved` — admin closed. metadata.{reportId, resolverId,
 *   resolution: 'no_action'|'warned'|'suspended'|'banned', notes?}.
 */

export const ABUSE_SEVERITY = [
  'spam',
  'phishing',
  'malware',
  'csam',
  'tos',
  'other',
] as const;
export type AbuseSeverity = (typeof ABUSE_SEVERITY)[number];

export const ABUSE_RESOLUTION = [
  'no_action',
  'warned',
  'suspended',
  'banned',
] as const;
export type AbuseResolution = (typeof ABUSE_RESOLUTION)[number];

export type AbuseStatus = 'open' | 'triaged' | 'resolved';

export interface CreateAbuseReportInput {
  targetUrl: string;
  reason: string;
  severity: AbuseSeverity;
  reporterContact: string | null;
  ipHash: string | null;
  userAgent: string | null;
}

export interface AbuseReportSummary {
  reportId: string;
  targetUrl: string;
  reason: string;
  severity: AbuseSeverity;
  status: AbuseStatus;
  reporterContact: string | null;
  createdAt: Date;
  lastActionAt: Date;
  resolution: AbuseResolution | null;
}

export async function createAbuseReport(input: CreateAbuseReportInput): Promise<{
  reportId: string;
}> {
  const reportId = newId('ar');
  await audit({
    actorId: null,
    projectId: null,
    action: 'abuse.report.created',
    ipHash: input.ipHash,
    userAgent: input.userAgent,
    metadata: {
      reportId,
      targetUrl: input.targetUrl,
      reason: input.reason,
      severity: input.severity,
      reporterContact: input.reporterContact,
    },
  });
  return { reportId };
}

interface ActionRow {
  action: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/**
 * List abuse reports filtered by status. Pulls every `abuse.report.*`
 * row in one query, buckets by reportId in memory, and derives the
 * current status from the latest transition. At Phase 3 scale (~hundreds
 * of reports), in-memory aggregation is fine; the dedicated
 * `abuse_reports` table planned for the post-drizzle-kit-unblock cleanup
 * will collapse this into a single indexed read.
 */
export async function listAbuseReports(
  filter: { status?: AbuseStatus; limit?: number } = {},
): Promise<AbuseReportSummary[]> {
  const db = getDb();
  const queryLimit = Math.min((filter.limit ?? 100) * 4, 2000);

  const rows = (await db
    .select({
      action: auditLogs.action,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(like(auditLogs.action, 'abuse.report.%'))
    .orderBy(desc(auditLogs.createdAt))
    .limit(queryLimit)) as ActionRow[];

  const byReport = new Map<string, ActionRow[]>();
  for (const r of rows) {
    const id = String(r.metadata.reportId ?? '');
    if (!id) continue;
    const list = byReport.get(id) ?? [];
    list.push(r);
    byReport.set(id, list);
  }

  const summaries: AbuseReportSummary[] = [];
  for (const [reportId, actions] of byReport) {
    const created = actions.find((a) => a.action === 'abuse.report.created');
    if (!created) continue; // orphan transitions — skip
    summaries.push(deriveSummary(reportId, created, actions));
  }
  summaries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const filtered = filter.status ? summaries.filter((s) => s.status === filter.status) : summaries;
  return filtered.slice(0, filter.limit ?? 100);
}

function deriveSummary(
  reportId: string,
  created: ActionRow,
  actions: readonly ActionRow[],
): AbuseReportSummary {
  const sorted = [...actions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const last = sorted[sorted.length - 1] ?? created;
  let status: AbuseStatus = 'open';
  if (last.action === 'abuse.report.triaged') status = 'triaged';
  else if (last.action === 'abuse.report.resolved') status = 'resolved';
  const resolution =
    last.action === 'abuse.report.resolved'
      ? ((last.metadata.resolution as AbuseResolution | undefined) ?? null)
      : null;
  return {
    reportId,
    targetUrl: String(created.metadata.targetUrl ?? ''),
    reason: String(created.metadata.reason ?? ''),
    severity: (created.metadata.severity as AbuseSeverity) ?? 'other',
    status,
    reporterContact: (created.metadata.reporterContact as string | null) ?? null,
    createdAt: created.createdAt,
    lastActionAt: last.createdAt,
    resolution,
  };
}

export interface TriageInput {
  reportId: string;
  triagerId: string;
  ipHash: string | null;
  userAgent: string | null;
  notes?: string;
}

export async function triageAbuseReport(input: TriageInput): Promise<void> {
  await audit({
    actorId: input.triagerId,
    projectId: null,
    action: 'abuse.report.triaged',
    ipHash: input.ipHash,
    userAgent: input.userAgent,
    metadata: {
      reportId: input.reportId,
      triagerId: input.triagerId,
      notes: input.notes ?? null,
    },
  });
}

export interface ResolveInput {
  reportId: string;
  resolverId: string;
  resolution: AbuseResolution;
  ipHash: string | null;
  userAgent: string | null;
  notes?: string;
}

export async function resolveAbuseReport(input: ResolveInput): Promise<void> {
  await audit({
    actorId: input.resolverId,
    projectId: null,
    action: 'abuse.report.resolved',
    ipHash: input.ipHash,
    userAgent: input.userAgent,
    metadata: {
      reportId: input.reportId,
      resolverId: input.resolverId,
      resolution: input.resolution,
      notes: input.notes ?? null,
    },
  });
}
