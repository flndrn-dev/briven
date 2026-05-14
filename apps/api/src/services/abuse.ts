import { newId } from '@briven/shared';
import { desc, eq, like } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { auditLogs, projects } from '../db/schema.js';
import { log } from '../lib/logger.js';
import { audit } from './audit.js';
import { publishEvent } from './outbound-webhooks.js';

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
  // Optional — the project being suspended/banned. When provided AND
  // the resolution is 'suspended' or 'banned', we flip projects.suspended_at.
  // For 'no_action' / 'warned' resolutions this is ignored.
  projectId?: string;
}

export async function resolveAbuseReport(input: ResolveInput): Promise<void> {
  const shouldSuspend = input.resolution === 'suspended' || input.resolution === 'banned';
  let suspended = false;

  if (shouldSuspend && input.projectId) {
    try {
      const db = getDb();
      const result = await db
        .update(projects)
        .set({
          suspendedAt: new Date(),
          suspendReason: `abuse_report:${input.reportId}:${input.resolution}`,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, input.projectId))
        .returning({ id: projects.id });
      suspended = result.length > 0;
      if (!suspended) {
        log.warn('abuse_resolve_project_not_found', {
          reportId: input.reportId,
          projectId: input.projectId,
        });
      }
    } catch (err) {
      // Don't block the audit row on a DB hiccup — the operator can
      // suspend manually from the admin UI as a recovery path.
      log.error('abuse_resolve_suspend_failed', {
        reportId: input.reportId,
        projectId: input.projectId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await audit({
    actorId: input.resolverId,
    projectId: input.projectId ?? null,
    action: 'abuse.report.resolved',
    ipHash: input.ipHash,
    userAgent: input.userAgent,
    metadata: {
      reportId: input.reportId,
      resolverId: input.resolverId,
      resolution: input.resolution,
      notes: input.notes ?? null,
      projectId: input.projectId ?? null,
      projectSuspended: suspended,
    },
  });
}

/**
 * Manual suspension — for admin actions outside the abuse pipeline
 * (e.g. operator notices something during a routine sweep). Mirrors the
 * resolve path but doesn't need a report id. Returns true when the
 * UPDATE matched a row.
 */
export async function suspendProject(args: {
  projectId: string;
  actorId: string;
  reason: string;
  ipHash: string | null;
  userAgent: string | null;
}): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(projects)
    .set({
      suspendedAt: new Date(),
      suspendReason: `manual:${args.reason}`,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, args.projectId))
    .returning({ id: projects.id });
  const ok = result.length > 0;
  await audit({
    actorId: args.actorId,
    projectId: args.projectId,
    action: 'admin.project.suspend',
    ipHash: args.ipHash,
    userAgent: args.userAgent,
    metadata: { reason: args.reason, matched: ok },
  });
  if (ok) {
    // Fan-out to any outbound webhook subscriber listening for
    // `project.suspended`. Failure here doesn't unwind the suspension —
    // the customer's ability to react quickly to a suspension is a
    // nice-to-have, the suspension itself is the load-bearing action.
    await publishEvent({
      projectId: args.projectId,
      eventType: 'project.suspended',
      payload: {
        projectId: args.projectId,
        reason: args.reason,
        suspendedAt: new Date().toISOString(),
      },
    }).catch((err: unknown) => {
      log.warn('outbound_publish_failed', {
        event: 'project.suspended',
        projectId: args.projectId,
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }
  return ok;
}

export async function unsuspendProject(args: {
  projectId: string;
  actorId: string;
  ipHash: string | null;
  userAgent: string | null;
}): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(projects)
    .set({ suspendedAt: null, suspendReason: null, updatedAt: new Date() })
    .where(eq(projects.id, args.projectId))
    .returning({ id: projects.id });
  const ok = result.length > 0;
  await audit({
    actorId: args.actorId,
    projectId: args.projectId,
    action: 'admin.project.unsuspend',
    ipHash: args.ipHash,
    userAgent: args.userAgent,
    metadata: { matched: ok },
  });
  if (ok) {
    await publishEvent({
      projectId: args.projectId,
      eventType: 'project.resumed',
      payload: {
        projectId: args.projectId,
        resumedAt: new Date().toISOString(),
      },
    }).catch((err: unknown) => {
      log.warn('outbound_publish_failed', {
        event: 'project.resumed',
        projectId: args.projectId,
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }
  return ok;
}

/**
 * Returns the suspension state for a project, or null when the project
 * isn't suspended. Used by the project-suspended middleware to gate
 * state-changing routes (invokes, deploys, env writes).
 */
export async function getProjectSuspension(
  projectId: string,
): Promise<{ suspendedAt: Date; reason: string | null } | null> {
  const db = getDb();
  const [row] = await db
    .select({ suspendedAt: projects.suspendedAt, suspendReason: projects.suspendReason })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!row || !row.suspendedAt) return null;
  return { suspendedAt: row.suspendedAt, reason: row.suspendReason };
}
