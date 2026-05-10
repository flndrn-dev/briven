import { newId } from '@briven/shared';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  auditLogs,
  functionLogs,
  projects,
  type NewFunctionLog,
  type ProjectTier,
} from '../db/schema.js';
import { getRedis } from '../lib/redis.js';
import { log } from '../lib/logger.js';

const BATCH_MAX = 500;
const BATCH_WINDOW_MS = 1_000;
const BLOCK_MS = 5_000;
const RECONNECT_BACKOFF_MS = [500, 1_000, 2_500, 5_000, 10_000];

/**
 * Subscribes to every project's `logs:{projectId}` stream and fans
 * entries out into the meta-DB `function_logs` table for durable storage
 * and dashboard queries. Best-effort — a crashed worker may drop recent
 * entries, which is acceptable for debug logs (audit logs use a separate
 * pathway with stronger guarantees).
 *
 * Single worker per api process; Phase 3+ can split into a dedicated
 * worker service if throughput demands.
 */
export function startLogFanoutWorker(): void {
  void runLoop().catch((err: unknown) => {
    log.error('log_fanout_worker_crashed', {
      message: err instanceof Error ? err.message : String(err),
    });
  });
}

async function runLoop(): Promise<void> {
  let attempt = 0;
  let lastId = '$'; // start from NEW entries on fresh boot
  while (true) {
    const sharedRedis = getRedis();
    if (!sharedRedis) {
      // No redis = nothing to fan out. Sleep a minute, reconsider config.
      await sleep(60_000);
      continue;
    }
    const blocking = sharedRedis.duplicate();
    try {
      log.info('log_fanout_connected');
      attempt = 0;
      while (true) {
        // Discover all active project streams. XREAD needs explicit stream
        // names; Redis can't wildcard. Per project this is one SCAN cycle
        // every BATCH_WINDOW_MS — cheap for <10k projects.
        const streams = await scanStreams(sharedRedis);
        if (streams.length === 0) {
          await sleep(BATCH_WINDOW_MS);
          continue;
        }
        const keys = streams.flat();
        const ids = streams.map(() => lastId);

        const reply = (await blocking.xread(
          'COUNT',
          BATCH_MAX,
          'BLOCK',
          BLOCK_MS,
          'STREAMS',
          ...keys,
          ...ids,
        )) as Array<[string, Array<[string, string[]]>]> | null;

        if (!reply) continue;

        const rows: NewFunctionLog[] = [];
        for (const [key, entries] of reply) {
          const projectId = key.slice('logs:'.length);
          for (const [id, flat] of entries) {
            const fields = parseFields(flat);
            if (fields.kind !== 'invocation') continue;
            rows.push(toRow(projectId, fields));
            lastId = id;
          }
        }
        if (rows.length > 0) {
          await persist(rows);
        }
      }
    } catch (err) {
      log.warn('log_fanout_disconnected', {
        message: err instanceof Error ? err.message : String(err),
      });
      blocking.disconnect();
      const delay = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)]!;
      attempt += 1;
      await sleep(delay);
    }
  }
}

async function scanStreams(redis: ReturnType<typeof getRedis>): Promise<string[][]> {
  if (!redis) return [];
  const out: string[][] = [];
  let cursor = '0';
  do {
    const [next, batch] = (await redis.scan(cursor, 'MATCH', 'logs:*', 'COUNT', 200)) as [
      string,
      string[],
    ];
    for (const key of batch) {
      // Exclude subscriber counters and other non-stream keys.
      if (key.startsWith('logs:subscribers:')) continue;
      out.push([key]);
    }
    cursor = next;
  } while (cursor !== '0');
  return out;
}

async function persist(rows: NewFunctionLog[]): Promise<void> {
  try {
    await getDb().insert(functionLogs).values(rows);
  } catch (err) {
    log.error('log_fanout_insert_failed', {
      count: rows.length,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function toRow(projectId: string, f: Record<string, string>): NewFunctionLog {
  return {
    id: newId('fn'),
    projectId,
    deploymentId: f.deploymentId ?? '',
    invocationId: f.invocationId ?? '',
    functionName: (f.functionName ?? '').slice(0, 128),
    status: (f.status ?? 'err').slice(0, 8),
    durationMs: (f.durationMs ?? '0').slice(0, 12),
    touchedTables: (f.touchedTables ?? '').split(',').filter(Boolean),
    userLogsJson: safeJson(f.logs) ?? [],
    errCode: f.errCode ?? null,
    errMessage: f.errMessage ?? null,
  };
}

function safeJson(raw: string | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseFields(flat: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < flat.length; i += 2) {
    const k = flat[i];
    const v = flat[i + 1];
    if (typeof k === 'string' && typeof v === 'string') out[k] = v;
  }
  return out;
}

/** Days of function-log retention per tier. Used by `pruneOldFunctionLogs`. */
export const RETENTION_DAYS_BY_TIER: Record<ProjectTier, number> = {
  free: 7,
  pro: 30,
  team: 90,
};

/**
 * Retention: drop `function_log` rows older than the per-tier cutoff. The
 * `projects.tier` column is the denormalised tier; we group projects by
 * tier (only three groups) and issue one DELETE per tier with that
 * tier's cutoff. A project that's been soft-deleted is treated as `free`
 * (shortest retention) — its data is on the way out anyway.
 *
 * Returns the total deleted-row count summed across tiers.
 */
export async function pruneOldFunctionLogs(): Promise<number> {
  const db = getDb();
  let total = 0;
  const now = Date.now();

  for (const [tier, days] of Object.entries(RETENTION_DAYS_BY_TIER) as Array<
    [ProjectTier, number]
  >) {
    const cutoff = new Date(now - days * 86_400_000);
    // Subquery: every project on this tier that isn't soft-deleted.
    // Soft-deleted projects fall through to the `free` (shortest) branch.
    const tierProjects = db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.tier, tier), isNull(projects.deletedAt)));

    const res = await db
      .delete(functionLogs)
      .where(
        and(
          lt(functionLogs.createdAt, cutoff),
          sql`${functionLogs.projectId} IN ${tierProjects}`,
        ),
      )
      .returning({ id: functionLogs.id });
    total += res.length;
    if (res.length > 0) {
      log.info('function_logs_pruned', {
        tier,
        days,
        count: res.length,
        cutoff: cutoff.toISOString(),
      });
    }
  }

  // Catch-all: soft-deleted projects + any projects whose tier somehow
  // doesn't match free|pro|team (data corruption hedge). Apply the
  // shortest retention.
  const freeCutoff = new Date(now - RETENTION_DAYS_BY_TIER.free * 86_400_000);
  const knownTiers = sql.raw(
    Object.keys(RETENTION_DAYS_BY_TIER).map((t) => `'${t}'`).join(','),
  );
  const orphans = db
    .select({ id: projects.id })
    .from(projects)
    .where(sql`${projects.deletedAt} IS NOT NULL OR ${projects.tier} NOT IN (${knownTiers})`);
  const orphanRes = await db
    .delete(functionLogs)
    .where(
      and(
        lt(functionLogs.createdAt, freeCutoff),
        sql`${functionLogs.projectId} IN ${orphans}`,
      ),
    )
    .returning({ id: functionLogs.id });
  total += orphanRes.length;
  if (orphanRes.length > 0) {
    log.info('function_logs_pruned', {
      tier: 'orphan',
      days: RETENTION_DAYS_BY_TIER.free,
      count: orphanRes.length,
      cutoff: freeCutoff.toISOString(),
    });
  }

  return total;
}

const RETENTION_TICK_MS = 6 * 60 * 60 * 1000;

export function startLogRetentionCron(): void {
  const run = (): void => {
    void pruneOldFunctionLogs().catch((err: unknown) => {
      log.warn('function_logs_prune_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    });
  };
  // Run once shortly after boot (so a restart doesn't skip a whole day if
  // the previous tick fired a few minutes before), then every 6h.
  setTimeout(run, 30_000);
  setInterval(run, RETENTION_TICK_MS);
}

/* ─── audit-log retention (privacy policy §5) ───────────────────────── */
// Privacy policy commits to a 13-month audit retention window. Anything
// older gets deleted on a daily sweep. Volume is low (a few hundred rows
// per day at our current scale) so we don't need batched deletes; the
// single statement runs in ms.

export const AUDIT_RETENTION_DAYS = 30 * 13; // 13 months ≈ 390 days

/**
 * Cutoff date for audit-log retention based on `now`. Extracted so the
 * boundary logic is unit-testable without standing up the DB.
 */
export function auditRetentionCutoff(nowMs: number): Date {
  return new Date(nowMs - AUDIT_RETENTION_DAYS * 86_400_000);
}

export async function pruneOldAuditLogs(): Promise<number> {
  const db = getDb();
  const cutoff = auditRetentionCutoff(Date.now());
  const res = await db
    .delete(auditLogs)
    .where(lt(auditLogs.createdAt, cutoff))
    .returning({ id: auditLogs.id });
  if (res.length > 0) {
    log.info('audit_logs_pruned', {
      count: res.length,
      retentionDays: AUDIT_RETENTION_DAYS,
      cutoff: cutoff.toISOString(),
    });
  }
  return res.length;
}

// 24h between runs. Audit volume is low so checking more often wastes
// db round-trips for no operational benefit.
const AUDIT_RETENTION_TICK_MS = 24 * 60 * 60 * 1000;

export function startAuditRetentionCron(): void {
  const run = (): void => {
    void pruneOldAuditLogs().catch((err: unknown) => {
      log.warn('audit_logs_prune_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    });
  };
  // 60s after boot (small offset from function-logs cron at 30s so a
  // fresh boot doesn't fire both simultaneously), then daily.
  setTimeout(run, 60_000);
  setInterval(run, AUDIT_RETENTION_TICK_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
