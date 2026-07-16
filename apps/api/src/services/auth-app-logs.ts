/**
 * Application logs for briven auth tenants (Phase 6.3).
 *
 * Structured operational logs (errors, warnings, info) that supplement
 * the audit log with diagnostic detail. Retention is tenant-configurable
 * via `authConfig.retention.appLogDays` (7/30/90).
 */

import { runInProjectDatabase } from '../db/data-plane.js';
import { ValidationError } from '@briven/shared';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export type LogLevel = 'error' | 'warn' | 'info';

export interface WriteAppLogInput {
  level: LogLevel;
  action: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface AppLogEntry {
  id: string;
  level: LogLevel;
  action: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export async function writeAppLog(
  projectId: string,
  input: WriteAppLogInput,
): Promise<void> {
  if (!['error', 'warn', 'info'].includes(input.level)) {
    throw new ValidationError('log level must be error, warn, or info', { level: input.level });
  }
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `INSERT INTO "_briven_auth_app_logs" (id, level, action, message, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [
        `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        input.level,
        input.action,
        input.message,
        JSON.stringify(input.metadata ?? {}),
      ] as never[],
    );
  });
}

export interface ListAppLogsOpts {
  limit?: number;
  level?: LogLevel;
  action?: string;
  cursor?: string | null;
}

export interface AppLogListResult {
  items: AppLogEntry[];
  nextCursor: string | null;
}

interface RawAppLogRow {
  id: string;
  level: string;
  action: string;
  message: string;
  metadata: unknown;
  created_at: Date;
}

export async function listAppLogs(
  projectId: string,
  opts: ListAppLogsOpts = {},
): Promise<AppLogListResult> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const where: string[] = ['1=1'];
  const params: unknown[] = [];

  if (opts.cursor) {
    const parsed = parseCursor(opts.cursor);
    params.push(parsed.createdAt, parsed.id);
    where.push(
      `(created_at < $${params.length - 1}::timestamptz OR (created_at = $${params.length - 1}::timestamptz AND id < $${params.length}))`,
    );
  }
  if (opts.level) {
    params.push(opts.level);
    where.push(`level = $${params.length}`);
  }
  if (opts.action) {
    params.push(opts.action);
    where.push(`action = $${params.length}`);
  }

  params.push(limit + 1);
  const limitPlaceholder = `$${params.length}`;

  const rows = await runInProjectDatabase<RawAppLogRow[]>(projectId, async (tx) => {
    return (await tx.unsafe(
      `
        SELECT id, level, action, message, metadata, created_at
        FROM "_briven_auth_app_logs"
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limitPlaceholder}
      `,
      params as never[],
    )) as RawAppLogRow[];
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const items = page.map((r) => ({
    id: r.id,
    level: r.level as LogLevel,
    action: r.action,
    message: r.message,
    metadata: isPlainObject(r.metadata) ? r.metadata : {},
    createdAt: r.created_at.toISOString(),
  }));

  const nextCursor = hasMore
    ? formatCursor({
        createdAt: page[page.length - 1]!.created_at.toISOString(),
        id: page[page.length - 1]!.id,
      })
    : null;

  return { items, nextCursor };
}

/**
 * Purge app logs older than the retention threshold.
 * Called by the janitor worker.
 */
export async function purgeOldAppLogs(
  projectId: string,
  retentionDays: number,
): Promise<{ deleted: number }> {
  const result = await runInProjectDatabase<{ count: number }[]>(projectId, async (tx) => {
    return (await tx.unsafe(
      `DELETE FROM "_briven_auth_app_logs"
       WHERE created_at < now() - interval '${retentionDays} days'
       RETURNING 1`,
    )) as { count: number }[];
  });
  return { deleted: result.length };
}

/**
 * Purge audit logs older than the retention threshold.
 */
export async function purgeOldAuditLogs(
  projectId: string,
  retentionDays: number,
): Promise<{ deleted: number }> {
  const result = await runInProjectDatabase<{ count: number }[]>(projectId, async (tx) => {
    return (await tx.unsafe(
      `DELETE FROM "_briven_auth_audit_log"
       WHERE occurred_at < now() - interval '${retentionDays} days'
       RETURNING 1`,
    )) as { count: number }[];
  });
  return { deleted: result.length };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function formatCursor(args: { createdAt: string; id: string }): string {
  return `${args.createdAt}__${args.id}`;
}

function parseCursor(raw: string): { createdAt: string; id: string } {
  const sepAt = raw.indexOf('__');
  if (sepAt <= 0) throw new ValidationError('invalid cursor', { cursor: raw });
  const createdAt = raw.slice(0, sepAt);
  const id = raw.slice(sepAt + 2);
  if (!id) throw new ValidationError('invalid cursor', { cursor: raw });
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new ValidationError('invalid cursor', { cursor: raw });
  }
  return { createdAt, id };
}
