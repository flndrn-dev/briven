import { newId } from '@briven/shared';
import { and, gte, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  marketingEvents,
  marketingEventTypes,
  type MarketingEventType,
} from '../db/schema.js';
import { log } from '../lib/logger.js';

/**
 * /migrate funnel tracking. Two event types:
 *   - migrate_view: a marketing page rendered for a given source
 *   - migrate_lead_submitted: the public lead form POST succeeded
 *
 * Writes never block the request that triggered them — failures are
 * logged and swallowed (a missing analytics row is preferable to a
 * 500 on the surface that wanted to track).
 */

const ALLOWED_SOURCES = new Set([
  'convex',
  'supabase',
  'firebase',
  'mongodb',
  'drizzle',
  'prisma',
  'postgres',
  'hasura',
  'nextauth',
  'other',
  'hub',
]);

interface TrackInput {
  eventType: string;
  source: string;
  ipHash?: string | null;
  userAgent?: string | null;
}

export async function trackMarketingEvent(input: TrackInput): Promise<void> {
  if (!(marketingEventTypes as readonly string[]).includes(input.eventType)) return;
  if (!ALLOWED_SOURCES.has(input.source)) return;
  try {
    const db = getDb();
    await db.insert(marketingEvents).values({
      id: newId('me'),
      eventType: input.eventType as MarketingEventType,
      source: input.source,
      ipHash: input.ipHash ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
    });
  } catch (err) {
    log.error('marketing_event_write_failed', {
      eventType: input.eventType,
      source: input.source,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

interface FunnelRow {
  source: string;
  views: number;
  leads: number;
  /** views → leads, as a 0–1 ratio. Null when views is 0. */
  conversion: number | null;
}

/**
 * Per-source funnel rollup. Single GROUP BY query so we stay cheap
 * even at high event volume. `since` defaults to 30 days ago.
 */
export async function getMarketingFunnel(opts: { sinceDays?: number } = {}): Promise<{
  rows: FunnelRow[];
  totals: FunnelRow;
  sinceDays: number;
}> {
  const db = getDb();
  const sinceDays = opts.sinceDays ?? 30;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      source: marketingEvents.source,
      views: sql<number>`count(*) filter (where ${marketingEvents.eventType} = 'migrate_view')`,
      leads: sql<number>`count(*) filter (where ${marketingEvents.eventType} = 'migrate_lead_submitted')`,
    })
    .from(marketingEvents)
    .where(and(gte(marketingEvents.createdAt, since)))
    .groupBy(marketingEvents.source);

  const parsed: FunnelRow[] = rows.map((r) => {
    const views = Number(r.views);
    const leads = Number(r.leads);
    return {
      source: r.source,
      views,
      leads,
      conversion: views > 0 ? leads / views : null,
    };
  });
  parsed.sort((a, b) => b.views - a.views);

  const totalViews = parsed.reduce((sum, r) => sum + r.views, 0);
  const totalLeads = parsed.reduce((sum, r) => sum + r.leads, 0);
  const totals: FunnelRow = {
    source: 'all',
    views: totalViews,
    leads: totalLeads,
    conversion: totalViews > 0 ? totalLeads / totalViews : null,
  };

  return { rows: parsed, totals, sinceDays };
}
