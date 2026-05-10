import { Hono } from 'hono';
import { z } from 'zod';

import { ipKey, rateLimit } from '../middleware/rate-limit.js';
import { ABUSE_SEVERITY, createAbuseReport } from '../services/abuse.js';
import { hashIp } from '../services/audit.js';
import type { AppEnv } from '../types/app-env.js';

/**
 * Public abuse-report intake. Anonymous (no auth) by design — anyone on
 * the internet can flag a deployed briven app. Rate-limited by IP to
 * keep the endpoint from being a spam vector against itself; the admin
 * triage queue (in routes/admin.ts) is where reports get reviewed.
 */
export const abuseRouter = new Hono<AppEnv>();

const createSchema = z.object({
  targetUrl: z.string().url().max(500),
  reason: z.string().min(1).max(2000),
  severity: z.enum(ABUSE_SEVERITY),
  reporterContact: z.string().max(200).nullable().optional(),
});

// Tight cap — abuse-report submissions should be bursty rare events,
// not a sustained stream from any one origin. cf-connecting-ip pinning
// is enforced by the rateLimit middleware itself outside dev.
abuseRouter.post(
  '/v1/abuse-reports',
  rateLimit({
    scope: 'abuse-report',
    limit: 5,
    windowMs: 60_000,
    key: ipKey,
  }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
        400,
      );
    }
    const fwd = c.req.raw.headers.get('cf-connecting-ip') ?? c.req.raw.headers.get('x-forwarded-for');
    const ip = fwd ? fwd.split(',')[0]!.trim() : null;
    const { reportId } = await createAbuseReport({
      targetUrl: parsed.data.targetUrl,
      reason: parsed.data.reason,
      severity: parsed.data.severity,
      reporterContact: parsed.data.reporterContact ?? null,
      ipHash: hashIp(ip),
      userAgent: c.req.header('user-agent') ?? null,
    });
    // 202 — we've accepted the report for triage but haven't acted yet.
    return c.json({ reportId, status: 'open' }, 202);
  },
);
