import { Hono } from 'hono';

import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { verifySignature } from '../lib/email.js';
import { audit } from '../services/audit.js';

/**
 * Inbound webhook receiver for mittera.eu — registered at the URL
 * configured on the mittera side (briven.tech/api/mittera-webhook,
 * which the dashboard's Next.js rewrite forwards to the api at
 * /mittera-webhook; for production traffic mittera should hit
 * https://api.briven.tech/mittera-webhook directly to avoid the
 * Cloudflare-edge mangling we saw on POST bodies through the rewrite).
 *
 * mittera signs each request with HMAC-SHA256(`${ts_ms}.${rawBody}`)
 * using the shared webhook secret and sends it across two headers:
 *   X-mittera-Signature: v1=<hex>
 *   X-mittera-Timestamp: <unix_milliseconds>
 *
 * Event payloads land in audit_logs with action="mittera.email.<type>"
 * so the operator can review delivery / bounce / complaint history
 * from the admin dashboard without provisioning a dedicated table.
 * Per CLAUDE.md §5.1 the recipient address is never written to the
 * audit log — we keep messageId so a support inquiry can be correlated
 * back to the original mittera message, but PII stays on mittera's
 * side.
 */

export const mitteraWebhookRouter = new Hono();

mitteraWebhookRouter.post('/mittera-webhook', async (c) => {
  if (!env.BRIVEN_MITTERA_WEBHOOK_SECRET) {
    log.warn('mittera_webhook_unconfigured');
    return c.json({ code: 'not_configured', message: 'mittera webhook secret unset' }, 503);
  }

  // Read the raw body — verifySignature operates on the exact bytes
  // mittera signed, so we must not let JSON.parse round-trip and lose
  // whitespace/escape ordering.
  const raw = await c.req.text();
  const sigHeader = c.req.header('x-mittera-signature') ?? c.req.header('mittera-signature') ?? null;
  const tsHeader = c.req.header('x-mittera-timestamp') ?? c.req.header('mittera-timestamp') ?? null;

  const ok = verifySignature({
    secret: env.BRIVEN_MITTERA_WEBHOOK_SECRET,
    signatureHeader: sigHeader,
    timestampHeader: tsHeader,
    body: raw,
  });

  if (!ok) {
    log.warn('mittera_webhook_signature_invalid', {
      hasSig: Boolean(sigHeader),
      hasTs: Boolean(tsHeader),
      bodyLen: raw.length,
    });
    return c.json({ code: 'invalid_signature', message: 'signature invalid or expired' }, 401);
  }

  // Best-effort parse for log enrichment. If it isn't JSON, accept anyway —
  // mittera's signature already proves authenticity.
  let event: {
    type?: string;
    messageId?: string;
    to?: string;
    // Optional context fields — captured if mittera provides them.
    bounceCode?: string;
    bounceMessage?: string;
    complaintReason?: string;
    deliveredAt?: string;
  } = {};
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    // ignore
  }

  const eventType = event.type ?? 'unknown';

  log.info('mittera_webhook_received', {
    type: eventType,
    messageId: event.messageId ?? null,
    hasRecipient: Boolean(event.to),
  });

  // Persist to audit_logs so the admin dashboard can render history.
  // No recipient (PII per §5.1); messageId is opaque to us so safe.
  await audit({
    actorId: null,
    projectId: null,
    action: `mittera.email.${eventType}`,
    ipHash: null,
    userAgent: 'mittera-webhook',
    metadata: {
      messageId: event.messageId ?? null,
      bounceCode: event.bounceCode ?? null,
      bounceMessage: event.bounceMessage ?? null,
      complaintReason: event.complaintReason ?? null,
      deliveredAt: event.deliveredAt ?? null,
    },
  });

  return c.json({ ok: true });
});
