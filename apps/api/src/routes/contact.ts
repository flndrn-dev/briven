import { ValidationError } from '@briven/shared';
import { Hono } from 'hono';
import { z } from 'zod';

import { contactTopics } from '../db/schema.js';
import { log } from '../lib/logger.js';
import { ipKey, rateLimit } from '../middleware/rate-limit.js';
import { audit, hashIp } from '../services/audit.js';
import { createContactMessage } from '../services/contact.js';
import type { AppEnv } from '../types/app-env.js';

/**
 * Public, unauthenticated contact intake. Lives on its own Hono router
 * (no requireAuth) so anyone can reach it from the /contact marketing
 * page. Rate-limited by IP (5/hour) to keep the endpoint from being a
 * spam vector. The sender's email is collected + stored so an operator
 * can reply privately — it is never echoed back in the response.
 */
export const contactPublicRouter = new Hono<AppEnv>();

export const contactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().min(1).max(320).email(),
  topic: z.enum(contactTopics),
  message: z.string().trim().min(1).max(8000),
});

contactPublicRouter.post(
  '/v1/contact',
  rateLimit({
    scope: 'contact-public',
    limit: 5,
    windowMs: 60 * 60_000,
    key: ipKey,
  }),
  async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const parsed = contactSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { code: 'validation_failed', message: parsed.error.issues[0]?.message ?? 'invalid body' },
        400,
      );
    }
    try {
      const requestId = await createContactMessage({
        name: parsed.data.name,
        email: parsed.data.email,
        topic: parsed.data.topic,
        message: parsed.data.message,
        ipHash: hashIpFromReq(c.req.raw.headers.get('x-forwarded-for')),
        userAgent: c.req.header('user-agent') ?? null,
      });
      await audit({
        actorId: null,
        projectId: null,
        action: 'contact_message.public_create',
        ipHash: hashIpFromReq(c.req.raw.headers.get('x-forwarded-for')),
        userAgent: c.req.header('user-agent') ?? null,
        metadata: { requestId, topic: parsed.data.topic },
      });
      // We deliberately return only the reference id — no PII echo to a
      // public endpoint, and never the email back to a curl caller.
      return c.json({ requestId }, 201);
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ code: 'validation_failed', message: err.message }, 400);
      }
      log.error('contact_message_create_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
);

function hashIpFromReq(forwarded: string | null): string | null {
  const ip = forwarded ? forwarded.split(',')[0]!.trim() : null;
  return hashIp(ip);
}
