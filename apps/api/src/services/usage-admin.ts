import { desc, eq } from 'drizzle-orm';

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
