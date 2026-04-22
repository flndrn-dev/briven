import { createHash } from 'node:crypto';

import { newId } from '@briven/shared';
import { desc, eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { auditLogs, type NewAuditLog } from '../db/schema.js';
import { log } from '../lib/logger.js';

/**
 * Hash the caller IP with a stable server-side pepper so we can correlate
 * abuse without ever storing raw IPs (CLAUDE.md §5.1).
 *
 * The pepper comes from BRIVEN_BETTER_AUTH_SECRET — rotating the secret
 * rotates the hash space, which is fine because audit correlations are
 * only meaningful within a short window anyway.
 */
export function hashIp(ip: string | null | undefined, pepper: string): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`${pepper}:${ip}`).digest('hex');
}

export interface AuditEntry {
  actorId: string | null;
  projectId: string | null;
  action: string;
  ipHash: string | null;
  userAgent: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditRow {
  id: string;
  action: string;
  actorId: string | null;
  ipHash: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * Recent audit entries for a project, newest first. Used by the dashboard
 * "activity" tab. The IP hash stays opaque; CLAUDE.md §5.1 forbids surfacing
 * raw IPs to the dashboard.
 */
export async function listAuditForProject(
  projectId: string,
  limit = 100,
): Promise<AuditRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      actorId: auditLogs.actorId,
      ipHash: auditLogs.ipHash,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(eq(auditLogs.projectId, projectId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
  }));
}

/**
 * Write an audit log entry. Failures never bubble up — an audit write
 * failing must not break the request the audit is for. We still log the
 * failure so the operator sees it.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const db = getDb();
    const row: NewAuditLog = {
      id: newId('au'),
      actorId: entry.actorId,
      projectId: entry.projectId,
      action: entry.action,
      ipHash: entry.ipHash,
      userAgent: entry.userAgent,
      metadata: entry.metadata ?? null,
    };
    await db.insert(auditLogs).values(row);
  } catch (err) {
    log.warn('audit_write_failed', {
      action: entry.action,
      projectId: entry.projectId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
