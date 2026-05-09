import { newId } from '@briven/shared';
import { lt } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { functionLogs, type NewFunctionLog } from '../db/schema.js';
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
  // eslint-disable-next-line no-constant-condition
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

/**
 * Retention: drop function_log rows older than 7 days on free tier. Called
 * from the daily cron in apps/api/src/workers/cron.ts (or similar). Tier-
 * aware retention is a Phase 3 refinement.
 */
export async function pruneOldFunctionLogs(days = 7): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const db = getDb();
  const res = await db.delete(functionLogs).where(lt(functionLogs.createdAt, cutoff)).returning({
    id: functionLogs.id,
  });
  log.info('function_logs_pruned', { count: res.length, cutoff: cutoff.toISOString() });
  return res.length;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
