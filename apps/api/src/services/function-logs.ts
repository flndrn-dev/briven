import { and, desc, eq, lt } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { functionLogs, type FunctionLog } from '../db/schema.js';

/**
 * Per-project function logs reader. Mirrors the audit-log pattern — fetch
 * recent rows ordered newest-first, optionally filtered by function name
 * or status. Pagination is offset-by-cursor via the `before` timestamp so
 * we don't fall over a hot project's million-row log table.
 *
 * The `function_logs` table itself is populated by the runtime's
 * log-fanout worker; this service is read-only.
 */
export interface ListFunctionLogsOpts {
  /** Filter by exact function name. */
  readonly functionName?: string;
  /** Filter by status: 'ok' | 'err'. */
  readonly status?: 'ok' | 'err';
  /** Page-after cursor — only rows with `createdAt < before` are returned. */
  readonly before?: Date;
  /** Max rows to return (capped at 200). */
  readonly limit?: number;
}

export async function listFunctionLogs(
  projectId: string,
  opts: ListFunctionLogsOpts = {},
): Promise<FunctionLog[]> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  const filters = [eq(functionLogs.projectId, projectId)];
  if (opts.functionName) {
    filters.push(eq(functionLogs.functionName, opts.functionName));
  }
  if (opts.status === 'ok' || opts.status === 'err') {
    filters.push(eq(functionLogs.status, opts.status));
  }
  if (opts.before) {
    filters.push(lt(functionLogs.createdAt, opts.before));
  }

  return db
    .select()
    .from(functionLogs)
    .where(filters.length === 1 ? filters[0] : and(...filters))
    .orderBy(desc(functionLogs.createdAt))
    .limit(limit);
}

/**
 * Distinct function names actually called in this project. Drives the
 * function picker on the logs page so the user can narrow to one
 * function without typing the name from memory.
 */
export async function listFunctionNames(projectId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .selectDistinct({ name: functionLogs.functionName })
    .from(functionLogs)
    .where(eq(functionLogs.projectId, projectId))
    .orderBy(functionLogs.functionName);
  return rows.map((r) => r.name);
}
