import { Hono } from 'hono';

import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { verifySignature } from '../lib/email.js';
import { audit } from '../services/audit.js';
import { suppress } from '../services/suppressions.js';

/**
 * Inbound webhook receiver for mittera.eu — registered at the URL
 * configured on the mittera side (https://api.briven.tech/mittera-webhook,
 * which bypasses the Cloudflare-edge mangling we saw on POST bodies
 * through the Next.js rewrite).
 *
 * Wire format (per mittera spec):
 *   X-mittera-Signature: v1=<hex_hmac_sha256(`${ts_ms}.${body}`)>
 *   X-mittera-Timestamp: <unix_milliseconds>
 *   X-mittera-Event:     email.delivered (etc.)
 *   X-mittera-Call:      <unique attempt id>
 *   X-mittera-Retry:     true | false
 *
 * Body shape (envelope):
 *   { id, type, createdAt, data: { id, status, from, to, ... } }
 *
 * Behaviour:
 *   - verify HMAC signature first; reject unsigned + replays >5min
 *   - audit-log every event (action="mittera.email.<type>")
 *   - mutate the suppression list for events that should stop sends:
 *       email.bounced + bounce.type==="Permanent"  → permanent_bounce
 *       email.complained                            → complaint
 *       email.suppressed                            → mittera_suppressed
 *   - everything else acks 200 (don't 4xx — mittera will retry)
 */

interface MitteraEnvelope {
  id?: string;
  type?: string;
  createdAt?: string;
  data?: MitteraEmailData;
}

interface MitteraEmailData {
  id?: string;
  status?: string;
  from?: string;
  to?: string | string[];
  occurredAt?: string;
  subject?: string;
  bounce?: { type?: string; subType?: string; message?: string };
  open?: { timestamp?: string; userAgent?: string; ip?: string; platform?: string };
  click?: { timestamp?: string; url?: string };
  suppression?: { type?: string; reason?: string; source?: string };
  failed?: { reason?: string };
  metadata?: Record<string, unknown>;
}

function recipientList(to: MitteraEmailData['to']): string[] {
  if (!to) return [];
  if (Array.isArray(to)) return to.filter((s): s is string => typeof s === 'string');
  return typeof to === 'string' ? [to] : [];
}

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
  const sigHeader =
    c.req.header('x-mittera-signature') ?? c.req.header('mittera-signature') ?? null;
  const tsHeader =
    c.req.header('x-mittera-timestamp') ?? c.req.header('mittera-timestamp') ?? null;

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

  // Best-effort parse — mittera's signature already proves authenticity,
  // so we still ack 200 even on a malformed body (logs the issue).
  let envelope: MitteraEnvelope = {};
  try {
    envelope = JSON.parse(raw) as MitteraEnvelope;
  } catch {
    log.warn('mittera_webhook_unparseable_body', { bodyLen: raw.length });
  }

  const eventType = envelope.type ?? 'unknown';
  const eventId = envelope.id ?? null;
  const data = envelope.data ?? {};
  const recipients = recipientList(data.to);

  // Mittera's handshake when you save a webhook URL — return 200,
  // skip the rest. Don't audit-log noise.
  if (eventType === 'webhook.test') {
    log.info('mittera_webhook_handshake', { eventId });
    return c.json({ ok: true });
  }

  log.info('mittera_webhook_received', {
    type: eventType,
    eventId,
    messageId: data.id ?? null,
    recipients: recipients.length,
    status: data.status ?? null,
  });

  // Persist to audit_logs so the admin dashboard can render history.
  // §5.1: never store recipient addresses here. messageId is opaque to
  // us; bounce/complaint/suppression context is event-meta, not PII.
  // Action shape: `mittera.<eventType>` (eventType already carries the
  // `email.` / `domain.` / `contact.` prefix, so we don't double it).
  await audit({
    actorId: null,
    projectId: null,
    action: `mittera.${eventType}`,
    ipHash: null,
    userAgent: 'mittera-webhook',
    metadata: {
      eventId,
      messageId: data.id ?? null,
      status: data.status ?? null,
      bounceType: data.bounce?.type ?? null,
      bounceSubType: data.bounce?.subType ?? null,
      bounceMessage: data.bounce?.message?.slice(0, 240) ?? null,
      suppressionType: data.suppression?.type ?? null,
      suppressionReason: data.suppression?.reason ?? null,
      failedReason: data.failed?.reason?.slice(0, 240) ?? null,
    },
  });

  // ─── suppression rules (per mittera spec §6) ────────────────────────
  // Permanent bounces, complaints, and mittera-side suppressions all
  // mean "stop sending to this recipient". Transient bounces don't
  // suppress — retries can succeed (mailbox full etc.).
  if (eventType === 'email.bounced' && data.bounce?.type === 'Permanent') {
    for (const r of recipients) {
      await suppress({
        email: r,
        reason: 'permanent_bounce',
        detail: data.bounce?.message?.slice(0, 240) ?? null,
        sourceEventId: eventId,
      });
    }
  } else if (eventType === 'email.complained') {
    for (const r of recipients) {
      await suppress({
        email: r,
        reason: 'complaint',
        detail: data.suppression?.reason ?? null,
        sourceEventId: eventId,
      });
    }
  } else if (eventType === 'email.suppressed') {
    for (const r of recipients) {
      await suppress({
        email: r,
        reason: 'mittera_suppressed',
        detail:
          [data.suppression?.type, data.suppression?.reason, data.suppression?.source]
            .filter(Boolean)
            .join(' · ') || null,
        sourceEventId: eventId,
      });
    }
  }
  // email.delivered, email.opened, email.clicked, email.queued, etc.
  // are already audit-logged above. Transient bounces are too — no
  // suppression action needed.

  return c.json({ ok: true });
});
