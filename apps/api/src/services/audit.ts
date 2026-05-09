import { createHash, randomBytes } from 'node:crypto';

import { newId } from '@briven/shared';
import { desc, eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { auditLogs, type NewAuditLog } from '../db/schema.js';
import { env } from '../env.js';
import { log } from '../lib/logger.js';

/**
 * Resolve the audit-log IP pepper. Refuses to boot in non-development when
 * BRIVEN_AUDIT_IP_PEPPER is unset. In dev we generate a per-process random
 * value — sufficient to keep dev workflows running without baking a
 * publicly-known string into the open-core source.
 *
 * The pepper is intentionally separate from BRIVEN_BETTER_AUTH_SECRET so a
 * leak of the audit-log column (or shell on the API host) can't be combined
 * with knowledge of the auth secret to de-anonymise every actor IP.
 */
let cachedPepper: string | null = null;
function getAuditIpPepper(): string {
  if (cachedPepper) return cachedPepper;
  if (env.BRIVEN_AUDIT_IP_PEPPER) {
    cachedPepper = env.BRIVEN_AUDIT_IP_PEPPER;
    return cachedPepper;
  }
  if (env.BRIVEN_ENV === 'development') {
    log.warn(
      'BRIVEN_AUDIT_IP_PEPPER not set — using ephemeral per-process pepper. Audit IP hashes will not correlate across restarts.',
    );
    cachedPepper = randomBytes(32).toString('hex');
    return cachedPepper;
  }
  throw new Error(
    'BRIVEN_AUDIT_IP_PEPPER is required outside development. Set a value of at least 32 chars.',
  );
}

/**
 * Hash the caller IP with the audit-log pepper so we can correlate abuse
 * without ever storing raw IPs (CLAUDE.md §5.1). The pepper is resolved
 * internally from BRIVEN_AUDIT_IP_PEPPER — callers no longer pass it.
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`${getAuditIpPepper()}:${ip}`).digest('hex');
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
export async function listAuditForProject(projectId: string, limit = 100): Promise<AuditRow[]> {
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
