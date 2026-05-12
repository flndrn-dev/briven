import { and, desc, eq, gte } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { usageEvents, type UsageEvent } from '../db/schema.js';

/**
 * Operator-facing read of usage_events. Filterable by polarPushStatus
 * (pending / pushed / skipped) so an admin can spot a backlog. Most
 * recent first; the unique index covers the order-by + filter.
 */
export async function listUsageEvents(args: {
  limit?: number;
  status?: string | undefined;
}): Promise<UsageEvent[]> {
  const db = getDb();
  const limit = Math.min(Math.max(args.limit ?? 200, 1), 1000);
  const status = args.status;
  if (status === 'pending' || status === 'pushed' || status === 'skipped') {
    return db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.polarPushStatus, status))
      .orderBy(desc(usageEvents.periodStart))
      .limit(limit);
  }
  return db
    .select()
    .from(usageEvents)
    .orderBy(desc(usageEvents.periodStart))
    .limit(limit);
}

/**
 * Flip recently-skipped usage_events rows back to 'pending' so the Polar
 * push worker drains them on the next tick. Used as the recovery path
 * after an operator fixes a config gap (e.g. set the missing meter id)
 * — see docs/runbooks/polar-metering-setup.md §5. Bounded by a sinceDays
 * window so a runaway click doesn't re-push years of stale rows that
 * a customer already paid for through a manual reconciliation.
 */
export async function retrySkippedUsageEvents(args: {
  sinceDays: number;
}): Promise<{ retried: number }> {
  // Clamp the window to a reasonable range — we never want to re-push
  // anything older than the meta-DB retention itself, and same-day
  // retries are the most common operator action.
  const days = Math.min(Math.max(args.sinceDays, 1), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const db = getDb();
  const result = await db
    .update(usageEvents)
    .set({ polarPushStatus: 'pending', polarPushedAt: null })
    .where(
      and(eq(usageEvents.polarPushStatus, 'skipped'), gte(usageEvents.periodStart, since)),
    )
    .returning({ id: usageEvents.id });
  return { retried: result.length };
}
