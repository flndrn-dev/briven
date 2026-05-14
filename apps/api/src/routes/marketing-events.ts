import { Hono } from 'hono';

import { ipKey, rateLimit } from '../middleware/rate-limit.js';
import { hashIp } from '../services/audit.js';
import { trackMarketingEvent } from '../services/marketing-events.js';
import type { AppEnv } from '../types/app-env.js';

/**
 * Public beacon for marketing funnel tracking. Receives `migrate_view`
 * events from the /migrate and /migrate/<source> marketing pages.
 *
 * Rate-limited per IP to keep the endpoint from being a write-amp
 * vector against the meta-DB. Lead-submit events are NOT fired through
 * this surface — they fire server-side from the POST /v1/migration-leads
 * handler so we don't trust a public POST to claim a conversion.
 */
export const marketingEventsPublicRouter = new Hono<AppEnv>();

marketingEventsPublicRouter.post(
  '/v1/marketing-events',
  rateLimit({
    scope: 'marketing-events',
    limit: 30,
    windowMs: 60_000,
    key: ipKey,
  }),
  async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return c.json({ ok: true });
    const eventType = typeof body.eventType === 'string' ? body.eventType : '';
    const source = typeof body.source === 'string' ? body.source : '';
    // We only accept page-view events through the public surface;
    // conversions can only be claimed server-side from the lead route.
    if (eventType !== 'migrate_view') return c.json({ ok: true });
    const fwd = c.req.raw.headers.get('cf-connecting-ip') ?? c.req.raw.headers.get('x-forwarded-for');
    const ip = fwd ? fwd.split(',')[0]!.trim() : null;
    await trackMarketingEvent({
      eventType,
      source,
      ipHash: hashIp(ip),
      userAgent: c.req.header('user-agent') ?? null,
    });
    return c.json({ ok: true });
  },
);
