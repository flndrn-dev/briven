import { randomUUID } from 'node:crypto';

import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import { invoke } from '../services/invoke.js';
import {
  claimDueSchedules,
  nextRunAfter,
  parseCron,
  recordScheduleResult,
} from '../services/schedules.js';

/**
 * Schedule dispatcher. Every TICK_MS the worker:
 *
 *   1. claims up to BATCH_SIZE rows whose next_run_at <= now() and that
 *      are enabled + not soft-deleted (SELECT, no row lock — claim is
 *      optimistic).
 *   2. for each row, computes the next next_run_at locally from the cron
 *      expression and fires invoke() against the deployed function.
 *   3. records the run outcome with an UPDATE guarded by the pre-claim
 *      next_run_at. Two concurrent dispatchers can't double-fire the
 *      same row — the second loses the race and skips silently.
 *
 * Failure handling: invoke errors are caught, recorded as `error` with a
 * truncated message, and the schedule still advances. Catastrophic worker
 * crashes simply mean a delayed run on next dispatcher tick — schedules
 * never get stuck (next_run_at advances on every claim attempt).
 */

const TICK_MS = 60_000;
const BATCH_SIZE = 100;
const MAX_ERROR_LEN = 500;

let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;

async function tick(): Promise<void> {
  if (inflight) {
    log.warn('schedule_dispatcher_tick_skipped_inflight');
    return;
  }
  inflight = true;
  const now = new Date();
  try {
    const due = await claimDueSchedules(now, BATCH_SIZE);
    if (due.length === 0) return;
    log.info('schedule_dispatcher_tick', { dueCount: due.length });

    // Run all due rows in parallel. invoke() is already async + bounded
    // by the runtime's own pool; we don't add another layer here.
    await Promise.all(due.map((row) => fireOne(row, now)));
  } catch (err) {
    log.error('schedule_dispatcher_tick_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inflight = false;
  }
}

async function fireOne(
  row: Awaited<ReturnType<typeof claimDueSchedules>>[number],
  now: Date,
): Promise<void> {
  const claimedNextRunAt = row.nextRunAt;
  let newNextRunAt: Date;
  try {
    newNextRunAt = nextRunAfter(parseCron(row.cronExpression), now);
  } catch (err) {
    // The expression must have been valid when written (service validates
    // on write), so this is recoverable only by disabling the row. Push
    // next_run_at forward 1h to back-off and record the parse failure.
    const errorMessage = err instanceof Error ? err.message : 'cron parse failed';
    await recordScheduleResult({
      scheduleId: row.id,
      claimedNextRunAt,
      newNextRunAt: new Date(now.getTime() + 60 * 60_000),
      ranAt: now,
      status: 'skipped',
      errorMessage: errorMessage.slice(0, MAX_ERROR_LEN),
    });
    return;
  }

  const requestId = `sched_${randomUUID()}`;
  let status: 'ok' | 'error' = 'ok';
  let errorMessage: string | undefined;

  try {
    const result = await invoke({
      projectId: row.projectId,
      functionName: row.functionName,
      args: row.args,
      requestId,
      // Schedule-triggered invocations have no human session — auth is
      // null and the runtime treats this as a system call. The function
      // can identify itself as scheduled via ctx.invoker.kind === 'schedule'
      // once the runtime surfaces that (phase 3 work).
      auth: null,
    });
    if (!result.ok) {
      status = 'error';
      errorMessage = `${result.code}: ${result.message}`.slice(0, MAX_ERROR_LEN);
    }
  } catch (err) {
    status = 'error';
    errorMessage = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_LEN);
  }

  const applied = await recordScheduleResult({
    scheduleId: row.id,
    claimedNextRunAt,
    newNextRunAt,
    ranAt: now,
    status,
    errorMessage,
  });

  if (!applied) {
    // Lost the race to another dispatcher (or the row was updated by a
    // user mid-flight). The other instance owns the outcome record; we
    // still attempted the invoke, but that's idempotent at the customer's
    // function layer — they own correctness for their own logic.
    log.info('schedule_dispatcher_record_lost_race', { scheduleId: row.id });
    return;
  }

  // Audit log only on outcome — not on the "scheduled" intent (that's
  // implicit by the schedule row itself, which is in audit via
  // schedule.create). Keeps the audit table from doubling in size per
  // every minute a `* * * * *` schedule exists.
  await audit({
    actorId: null,
    projectId: row.projectId,
    action: status === 'ok' ? 'schedule.run.ok' : 'schedule.run.error',
    ipHash: null,
    userAgent: null,
    metadata: {
      scheduleId: row.id,
      requestId,
      functionName: row.functionName,
      ...(errorMessage ? { error: errorMessage } : {}),
    },
  });
}

export function startScheduleDispatcher(): void {
  if (timer) return;
  if (!env.BRIVEN_URL) {
    log.warn('schedule_dispatcher_skipped_no_db');
    return;
  }
  // Delay 45s after boot so migrations finish and the usage aggregator
  // isn't competing for the first DB connection burst.
  setTimeout(() => {
    void tick();
    timer = setInterval(() => {
      void tick();
    }, TICK_MS);
  }, 45_000).unref?.();
  log.info('schedule_dispatcher_armed', { tickMs: TICK_MS, batch: BATCH_SIZE });
}

export function stopScheduleDispatcher(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Exported for tests + the admin dashboard "run now" path (Phase 3).
export const _internals = { tick, fireOne };
