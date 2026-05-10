import { Hono } from 'hono';

import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { verifySignature } from '../lib/email.js';

/**
 * Inbound webhook receiver for mittera.eu — registered at the URL
 * configured on the mittera side (briven.tech/api/mittera-webhook,
 * which the dashboard's Next.js rewrite forwards to the api at
 * /mittera-webhook).
 *
 * mittera signs each request with HMAC-SHA256 of `<ts>.<body>` using
 * the shared signing secret and sends the signature in the
 * `Mittera-Signature` header (Stripe convention: `t=<ts>,v1=<hex>`).
 *
 * Event payloads are deliberately not yet stored — this initial slice
 * verifies, logs, and ack-200's so mittera's retry queue stops. Once
 * we have a `email_events` table (delivered / opened / bounced /
 * complained) we can dispatch from here.
 */

export const mitteraWebhookRouter = new Hono();

mitteraWebhookRouter.post('/mittera-webhook', async (c) => {
  if (!env.BRIVEN_MITTERA_SIGNING_SECRET) {
    log.warn('mittera_webhook_unconfigured');
    return c.json({ code: 'not_configured', message: 'mittera signing secret unset' }, 503);
  }

  // Read the raw body — verifySignature operates on the exact bytes
  // mittera signed, so we must not let JSON.parse round-trip and lose
  // whitespace/escape ordering.
  const raw = await c.req.text();
  const sigHeader = c.req.header('mittera-signature') ?? null;

  const ok = verifySignature({
    secret: env.BRIVEN_MITTERA_SIGNING_SECRET,
    header: sigHeader,
    body: raw,
  });

  if (!ok) {
    log.warn('mittera_webhook_signature_invalid', {
      hasHeader: Boolean(sigHeader),
      bodyLen: raw.length,
    });
    return c.json({ code: 'invalid_signature', message: 'signature invalid or expired' }, 401);
  }

  // Best-effort parse for log enrichment. If it isn't JSON, accept anyway —
  // mittera's signature already proves authenticity.
  let event: { type?: string; messageId?: string; to?: string } = {};
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    // ignore
  }

  log.info('mittera_webhook_received', {
    type: event.type ?? null,
    messageId: event.messageId ?? null,
    // Don't log the recipient — PII. Hash later when we add events table.
    hasRecipient: Boolean(event.to),
  });

  return c.json({ ok: true });
});
