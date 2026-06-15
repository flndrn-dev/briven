import { env } from '../env.js';
import { audit } from '../services/audit.js';
import {
  claimDueAutoSnapshots,
  nextAutoRunAfter,
  recordAutoSnapshotResult,
  type DueAutoSnapshot,
} from '../services/auto-snapshots.js';
import { log } from '../lib/logger.js';
import { createSnapshot, pruneAutoSnapshots } from '../services/snapshots.js';

/**
 * Automatic scheduled snapshots worker. Every TICK_MS:
 *
 *   1. claims auto-snapshot settings rows that are due (enabled and
 *      next_run_at <= now) — optimistic SELECT, no row lock.
 *   2. for each, takes an `auto`-flagged snapshot (createSnapshot), then
 *      prunes auto snapshots beyond retentionCount (pruneAutoSnapshots).
 *      Manual snapshots are never counted or deleted.
 *   3. records the outcome with an UPDATE guarded by the pre-claim
 *      next_run_at, advancing it to the next slot. Two workers can't
 *      double-fire the same project — the loser skips silently.
 *
 * Idempotent: a crash mid-run just means the project's next_run_at hasn't
 * advanced yet, so the next tick retries it. A re-run never prunes manual
 * snapshots or removes more than the retention math dictates.
 *
 * This is the same trigger mechanism Briven already uses for scheduled
 * function invocations (workers/schedule-dispatcher.ts): an in-process
 * interval armed at boot. The run logic is also exposed to an internal
 * HTTP endpoint (POST /v1/internal/auto-snapshots/run) so an external cron
 * can drive it in deployments that prefer that over the in-process timer.
 */

const TICK_MS = 5 * 60 * 1000; // 5 min — checks are cheap; cadence is hours
const BATCH_SIZE = 50;
const MAX_ERROR_LEN = 500;

let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;

/**
 * Run every due project's auto-snapshot once. Returns a small summary the
 * internal endpoint can echo back. Safe to call concurrently with the
 * in-process timer — the per-row claim guard prevents double-firing.
 */
export async function runDueAutoSnapshots(
  now: Date = new Date(),
  limit: number = BATCH_SIZE,
): Promise<{ due: number; succeeded: number; failed: number }> {
  const due = await claimDueAutoSnapshots(now, limit);
  if (due.length === 0) return { due: 0, succeeded: 0, failed: 0 };
  log.info('auto_snapshot_tick', { dueCount: due.length });

  let succeeded = 0;
  let failed = 0;
  // Run projects in parallel; each is an independent data-plane operation.
  const outcomes = await Promise.all(due.map((row) => runOne(row, now)));
  for (const ok of outcomes) {
    if (ok) succeeded += 1;
    else failed += 1;
  }
  return { due: due.length, succeeded, failed };
}

async function runOne(row: DueAutoSnapshot, now: Date): Promise<boolean> {
  const claimedNextRunAt = row.nextRunAt;
  const newNextRunAt = nextAutoRunAfter(row.frequency, now);
  // Clear, dated label so auto snapshots are obvious in the list. The
  // `auto: true` flag is what pruning keys off — the name is just for humans.
  const name = `auto-${now.toISOString().slice(0, 10)}`;

  let status: 'ok' | 'error' = 'ok';
  let errorMessage: string | undefined;
  let snapshotId: string | undefined;
  let pruned = 0;

  try {
    const snap = await createSnapshot(row.projectId, name, { auto: true });
    snapshotId = snap.id;
    const result = await pruneAutoSnapshots(row.projectId, row.retentionCount);
    pruned = result.pruned.length;
  } catch (err) {
    status = 'error';
    errorMessage = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_LEN);
    log.error('auto_snapshot_failed', { projectId: row.projectId, message: errorMessage });
  }

  const applied = await recordAutoSnapshotResult({
    settingsId: row.id,
    claimedNextRunAt,
    newNextRunAt,
    ranAt: now,
    status,
    errorMessage,
  });
  if (!applied) {
    // Lost the race to a concurrent run; the other owns the outcome record.
    log.info('auto_snapshot_record_lost_race', { projectId: row.projectId });
    return status === 'ok';
  }

  await audit({
    actorId: null,
    projectId: row.projectId,
    action: status === 'ok' ? 'studio.snapshot.auto.create' : 'studio.snapshot.auto.error',
    ipHash: null,
    userAgent: null,
    metadata: {
      ...(snapshotId ? { snapshotId } : {}),
      pruned,
      frequency: row.frequency,
      retentionCount: row.retentionCount,
      ...(errorMessage ? { error: errorMessage } : {}),
    },
  });
  return status === 'ok';
}

async function tick(): Promise<void> {
  if (inflight) {
    log.warn('auto_snapshot_tick_skipped_inflight');
    return;
  }
  inflight = true;
  try {
    await runDueAutoSnapshots(new Date());
  } catch (err) {
    log.error('auto_snapshot_tick_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inflight = false;
  }
}

/**
 * Arm the auto-snapshot worker. Idempotent — a second call is a no-op.
 * Skipped when the control-plane DB isn't configured (dev / pre-migration).
 */
export function startAutoSnapshotWorker(): void {
  if (timer) return;
  if (!env.BRIVEN_DATABASE_URL) {
    log.warn('auto_snapshot_worker_skipped_no_db');
    return;
  }
  // 150s after boot — last in the worker startup cascade (storage janitor
  // is 120s), keeping the boot-time connection-pool burst smooth.
  setTimeout(() => {
    void tick();
    timer = setInterval(() => {
      void tick();
    }, TICK_MS);
  }, 150_000).unref?.();
  log.info('auto_snapshot_worker_armed', { tickMs: TICK_MS, batch: BATCH_SIZE });
}

export function stopAutoSnapshotWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export const _internals = { tick, runOne };
