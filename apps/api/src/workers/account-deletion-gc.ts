import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { hardDeleteExpiredAccounts } from '../services/account-deletion.js';

/**
 * Hard-delete-after-grace-window cron. Soft-deleted accounts have a
 * 30-day reversal window during which operator support can revert
 * via SQL. After that, this worker scans for rows whose
 * `users.deleted_at` is older than the threshold and DELETEs them —
 * cascades fire via the FK ON DELETE rules already in the schema.
 *
 * Daily cadence is enough — the threshold is 30 days; running every
 * hour would just churn the same predicate. Aligned to ~03:30 UTC so
 * it doesn't compete with the hourly usage aggregator (xx:05).
 *
 * Idempotent: a re-run after a crash mid-run is safe.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TARGET_UTC_HOUR = 3;
const TARGET_UTC_MINUTE = 30;

let timer: ReturnType<typeof setInterval> | null = null;

function nextRunOffsetMs(now: Date = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(TARGET_UTC_HOUR, TARGET_UTC_MINUTE, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

async function tick(): Promise<void> {
  try {
    const deleted = await hardDeleteExpiredAccounts({ graceDays: 30 });
    if (deleted > 0) {
      log.info('account_deletion_gc_tick', { deleted });
    }
  } catch (err) {
    log.error('account_deletion_gc_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Start the daily account-deletion garbage collector. Idempotent — a
 * second call is a no-op. Skipped entirely when the database isn't
 * configured (dev / boot before migrations).
 */
export function startAccountDeletionGc(): void {
  if (timer) return;
  if (!env.BRIVEN_DATABASE_URL) {
    log.warn('account_deletion_gc_skipped_no_db');
    return;
  }
  const offset = nextRunOffsetMs();
  setTimeout(() => {
    void tick();
    timer = setInterval(() => {
      void tick();
    }, DAY_MS);
  }, offset).unref?.();
  log.info('account_deletion_gc_armed', { firstRunInMs: offset });
}
