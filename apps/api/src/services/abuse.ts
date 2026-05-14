import { newId, NotFoundError } from '@briven/shared';
import { and, desc, eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { abuseReports, projects } from '../db/schema.js';
import { log } from '../lib/logger.js';
import { audit } from './audit.js';
import { publishEvent } from './outbound-webhooks.js';

/**
 * Phase 3 abuse-report pipeline.
 *
 * Reports persist in the dedicated `abuse_reports` table (the §cross-
 * cutting cleanup that was previously gated on drizzle-kit unblock has
 * shipped — see migration 0023). audit_logs still receives one row per
 * state transition for the security-log perspective: a single source of
 * truth for "who did what when" across the platform, where abuse-row
 * UPDATEs would otherwise hide intent.
 *
 * Lifecycle: open → triaged → resolved (resolution ∈ {no_action,
 * warned, suspended, banned}). Suspended/banned resolutions flip
 * projects.suspended_at on the named project_id when provided; the
 * outbound webhook fan-out (project.suspended) follows in the
 * suspendProject path below.
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
  const db = getDb();
  await db.insert(abuseReports).values({
    id: reportId,
    targetUrl: input.targetUrl,
    reason: input.reason,
    severity: input.severity,
    reporterContact: input.reporterContact,
    sourceIpHash: input.ipHash,
    sourceUserAgent: input.userAgent,
    // status defaults to 'open' at the DB layer.
  });
  // Audit-trail companion. Lets a security review see the lifecycle in
  // the same place as every other platform action — abuse_reports is
  // the source of truth, audit_logs is the cross-system narrative.
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

/**
 * List abuse reports filtered by status. Single indexed read from the
 * dedicated table, ordered by created_at desc.
 */
export async function listAbuseReports(
  filter: { status?: AbuseStatus; limit?: number } = {},
): Promise<AbuseReportSummary[]> {
  const db = getDb();
  const rows = filter.status
    ? await db
        .select()
        .from(abuseReports)
        .where(eq(abuseReports.status, filter.status))
        .orderBy(desc(abuseReports.createdAt))
        .limit(filter.limit ?? 100)
    : await db
        .select()
        .from(abuseReports)
        .orderBy(desc(abuseReports.createdAt))
        .limit(filter.limit ?? 100);

  return rows.map((r) => ({
    reportId: r.id,
    targetUrl: r.targetUrl,
    reason: r.reason,
    severity: r.severity,
    status: r.status,
    reporterContact: r.reporterContact,
    createdAt: r.createdAt,
    lastActionAt: r.updatedAt,
    resolution: r.resolution,
  }));
}

export interface TriageInput {
  reportId: string;
  triagerId: string;
  ipHash: string | null;
  userAgent: string | null;
  notes?: string;
}

export async function triageAbuseReport(input: TriageInput): Promise<void> {
  const db = getDb();
  const now = new Date();
  // Only transition `open` → `triaged`; an already-triaged or resolved
  // report shouldn't bounce back. The WHERE guards the state machine.
  const updated = await db
    .update(abuseReports)
    .set({
      status: 'triaged',
      triagedAt: now,
      triagedBy: input.triagerId,
      triageNotes: input.notes ?? null,
      updatedAt: now,
    })
    .where(and(eq(abuseReports.id, input.reportId), eq(abuseReports.status, 'open')))
    .returning({ id: abuseReports.id });
  if (!updated[0]) {
    throw new NotFoundError('abuse_report (open)', input.reportId);
  }
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
  const db = getDb();
  const now = new Date();

  if (shouldSuspend && input.projectId) {
    try {
      const result = await db
        .update(projects)
        .set({
          suspendedAt: now,
          suspendReason: `abuse_report:${input.reportId}:${input.resolution}`,
          updatedAt: now,
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
      // Don't block the report transition on a DB hiccup — the operator
      // can suspend manually from the admin UI as a recovery path.
      log.error('abuse_resolve_suspend_failed', {
        reportId: input.reportId,
        projectId: input.projectId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Transition the report row. Accept any prior non-resolved state so
  // the operator can resolve directly from `open` without a separate
  // triage click — common for quick-decision spam.
  const updated = await db
    .update(abuseReports)
    .set({
      status: 'resolved',
      resolution: input.resolution,
      resolvedAt: now,
      resolvedBy: input.resolverId,
      resolveNotes: input.notes ?? null,
      projectId: input.projectId ?? null,
      updatedAt: now,
    })
    .where(eq(abuseReports.id, input.reportId))
    .returning({ id: abuseReports.id });
  if (!updated[0]) {
    throw new NotFoundError('abuse_report', input.reportId);
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
