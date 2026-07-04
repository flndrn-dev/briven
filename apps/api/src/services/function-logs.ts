import { and, desc, eq, lt, sql } from 'drizzle-orm';

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

export interface HourlyInvocations {
  /** ISO timestamp at the top of the hour (UTC). */
  readonly hour: string;
  readonly count: number;
  readonly errCount: number;
}

/**
 * 24-hour invocation timeseries bucketed by hour. Drives the project
 * overview's sparkline. Fills missing hours with zeros so the chart
 * always has 24 points regardless of how sparse the traffic is.
 */
export async function getHourlyInvocations(
  projectId: string,
): Promise<readonly HourlyInvocations[]> {
  const db = getDb();
  // ISO string, not Date: postgres.js can't serialize a raw Date param in
  // sql`` templates under Bun ("string argument … Received an instance of
  // Date") — the ::timestamptz cast makes the string unambiguous.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // generate_series fills missing hours so the chart is a stable 24 points.
  const rows = (await db.execute(sql`
    WITH hours AS (
      SELECT generate_series(
        date_trunc('hour', ${since}::timestamptz),
        date_trunc('hour', now()),
        interval '1 hour'
      ) AS hour
    ),
    logs AS (
      SELECT
        date_trunc('hour', created_at) AS hour,
        count(*)::int AS count,
        count(*) FILTER (WHERE status = 'err')::int AS err_count
      FROM function_logs
      WHERE project_id = ${projectId}
        AND created_at >= ${since}::timestamptz
      GROUP BY 1
    )
    SELECT
      hours.hour AS hour,
      coalesce(logs.count, 0) AS count,
      coalesce(logs.err_count, 0) AS err_count
    FROM hours
    LEFT JOIN logs ON logs.hour = hours.hour
    ORDER BY hours.hour
  `)) as Array<{ hour: string | Date; count: number | string; err_count: number | string }>;
  return rows.map((r) => ({
    hour: (r.hour instanceof Date ? r.hour : new Date(r.hour)).toISOString(),
    count: Number(r.count) || 0,
    errCount: Number(r.err_count) || 0,
  }));
}

export interface FunctionStats {
  readonly count: number;
  readonly errCount: number;
  readonly p50Ms: number;
  readonly p99Ms: number;
}

/**
 * Per-function aggregates over the last N hours. Drives the per-function
 * stats badge on the functions tab. Uses percentile_cont — postgres-only
 * but the function_logs table is always in postgres so that's fine.
 *
 * durationMs is stored as varchar (legacy choice from the runtime payload
 * shape) — CAST to numeric for the aggregation.
 */
export async function getFunctionStats(
  projectId: string,
  functionName: string,
  sinceHours = 24,
): Promise<FunctionStats> {
  const db = getDb();
  // ISO string, not Date — same driver limitation as getHourlyInvocations.
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();
  const rows = (await db.execute(sql`
    SELECT
      count(*)::int AS count,
      count(*) FILTER (WHERE status = 'err')::int AS err_count,
      coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY (duration_ms::numeric)), 0) AS p50,
      coalesce(percentile_cont(0.99) WITHIN GROUP (ORDER BY (duration_ms::numeric)), 0) AS p99
    FROM function_logs
    WHERE project_id = ${projectId}
      AND function_name = ${functionName}
      AND created_at >= ${since}::timestamptz
  `)) as Array<{
    count: number | string;
    err_count: number | string;
    p50: number | string;
    p99: number | string;
  }>;
  const row = rows[0];
  if (!row) {
    return { count: 0, errCount: 0, p50Ms: 0, p99Ms: 0 };
  }
  return {
    count: Number(row.count) || 0,
    errCount: Number(row.err_count) || 0,
    p50Ms: Math.round(Number(row.p50) || 0),
    p99Ms: Math.round(Number(row.p99) || 0),
  };
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
