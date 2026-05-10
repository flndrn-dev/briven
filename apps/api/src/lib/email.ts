import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../env.js';
import { isSuppressed } from '../services/suppressions.js';
import { log } from './logger.js';

/**
 * Transactional email client — talks to mittera.eu's REST API at
 * /api/v1/emails using Bearer-token auth. Inbound delivery / bounce /
 * complaint events arrive at /mittera-webhook signed with mittera's
 * X-mittera-Signature scheme; verifySignature below mirrors mittera's
 * own SDK so the receiver stays in lock-step with the publisher.
 *
 * Outbound request shape:
 *   POST {BRIVEN_MITTERA_API_URL}/api/v1/emails
 *   Authorization: Bearer {BRIVEN_MITTERA_API_KEY}
 *   Content-Type: application/json
 *   { from, to, subject, html, text }
 *
 * Inbound webhook headers (verified by verifySignature, not produced
 * by this module):
 *   X-mittera-Signature: v1=<hex_hmac_sha256("${ts_ms}.${rawBody}")>
 *   X-mittera-Timestamp: <unix_milliseconds>
 *
 * In dev (no API key configured) emails print to stdout so the
 * first-user bootstrap flow still works on a fresh self-host.
 */

const SEND_PATH = '/api/v1/emails';
const SIGNATURE_PREFIX = 'v1=';
const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

function fromAddress(): string {
  // Use the configured public domain so the From: matches the deployment.
  // Falls back to a literal in dev so the env never has to be set locally.
  const domain = env.BRIVEN_DOMAIN ?? 'briven.local';
  return `briven <noreply@${domain}>`;
}

function isConfigured(): boolean {
  return Boolean(env.BRIVEN_MITTERA_API_URL && env.BRIVEN_MITTERA_API_KEY);
}

async function send(label: string, args: SendArgs): Promise<void> {
  // Suppression guard — never POST to mittera for a recipient on the
  // local suppression list (permanent bounce, complaint, mittera-side
  // suppression). Cheaper than a 4xx + retry storm; protects sender
  // reputation from re-sending to a known-bad address.
  if (await isSuppressed(args.to)) {
    log.warn(`${label}_recipient_suppressed`, {
      // recipient logged ONLY at this stage — already on our suppression
      // list, not new PII.
      to: args.to,
    });
    return;
  }

  // Dev fallback: print so j can complete bootstrap without external email.
  if (!isConfigured()) {
    log.warn(`${label}_logged_only`);
    process.stdout.write(`\n  ${label} (dev only):\n  to: ${args.to}\n  subject: ${args.subject}\n\n`);
    return;
  }

  const body = JSON.stringify({
    from: fromAddress(),
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
  });

  const url = `${env.BRIVEN_MITTERA_API_URL!.replace(/\/$/, '')}${SEND_PATH}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.BRIVEN_MITTERA_API_KEY!}`,
    },
    body,
    // Hard cap so a hung mittera doesn't tie up the magic-link request.
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    log.error('mittera_send_failed', {
      status: res.status,
      label,
      // Truncate so a misconfigured server returning HTML doesn't bloat logs.
      body: text.slice(0, 240),
    });
    throw new Error(`mittera send failed: ${res.status}`);
  }
}

export async function sendMagicLink(to: string, url: string): Promise<void> {
  await send('magic_link', {
    to,
    subject: 'your briven sign-in link',
    html: magicLinkHtml(url),
    text: magicLinkText(url),
  });
}

export async function sendInvitation(to: string, url: string): Promise<void> {
  await send('invitation', {
    to,
    subject: 'you were invited to a briven project',
    html: invitationHtml(url),
    text: invitationText(url),
  });
}

export async function sendEmailVerification(to: string, url: string): Promise<void> {
  await send('verify_email', {
    to,
    subject: 'verify your briven email',
    html: verifyEmailHtml(url),
    text: verifyEmailText(url),
  });
}

/**
 * Verify a `X-mittera-Signature: v1=<hex>` header against the raw
 * request body using the shared webhook secret. The timestamp lives
 * in a separate `X-mittera-Timestamp` header (unix milliseconds) and
 * is checked against `nowMs` (default `Date.now()`) with the configured
 * `toleranceMs` (default ±5 min) to defeat replay.
 *
 * Mirrors `@mittera/sdk`'s Webhooks verifier exactly so a future swap
 * to the SDK is one-line.
 */
export function verifySignature(args: {
  secret: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  body: string;
  toleranceMs?: number;
  nowMs?: number;
}): boolean {
  if (!args.signatureHeader || !args.timestampHeader) return false;
  if (!args.signatureHeader.startsWith(SIGNATURE_PREFIX)) return false;

  const ts = Number(args.timestampHeader);
  if (!Number.isFinite(ts)) return false;

  const tolerance = args.toleranceMs ?? DEFAULT_TOLERANCE_MS;
  const now = args.nowMs ?? Date.now();
  if (Math.abs(now - ts) > tolerance) return false;

  const expected = `${SIGNATURE_PREFIX}${createHmac('sha256', args.secret)
    .update(`${args.timestampHeader}.${args.body}`)
    .digest('hex')}`;

  if (expected.length !== args.signatureHeader.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(args.signatureHeader, 'utf8'),
    );
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Email HTML — dark palette, single column, primary CTA in brand green.      */
/* -------------------------------------------------------------------------- */

function magicLinkHtml(url: string): string {
  return shell(
    'sign in to briven',
    `
    <p>click the button below to sign in. this link expires in 10 minutes.</p>
    ${cta('sign in', url)}
    <p class="muted">if you didn't request this, you can ignore this email.</p>
  `,
  );
}

function magicLinkText(url: string): string {
  return `sign in to briven\n\n${url}\n\nthis link expires in 10 minutes. if you didn't request it, ignore this email.`;
}

function invitationHtml(url: string): string {
  return shell(
    'you were invited to a briven project',
    `
    <p>accept the invitation to join the project on briven. the link expires in 7 days.</p>
    ${cta('accept invitation', url)}
    <p class="muted">if you weren't expecting this, ignore the email — nothing happens.</p>
  `,
  );
}

function invitationText(url: string): string {
  return `you were invited to a briven project\n\n${url}\n\nexpires in 7 days.`;
}

function verifyEmailHtml(url: string): string {
  return shell(
    'verify your briven email',
    `
    <p>confirm this address so we can reach you about your briven account.</p>
    ${cta('verify email', url)}
  `,
  );
}

function verifyEmailText(url: string): string {
  return `verify your briven email\n\n${url}\n`;
}

function cta(label: string, href: string): string {
  return `<p style="margin:32px 0"><a href="${href}" style="display:inline-block;background:#00e87a;color:#0a0b0d;padding:12px 24px;border-radius:10px;font-weight:500;font-family:system-ui,sans-serif;text-decoration:none">${label}</a></p>`;
}

function shell(title: string, body: string): string {
  const domain = env.BRIVEN_DOMAIN ?? 'briven.tech';
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><title>${title}</title></head>
<body style="margin:0;background:#0a0b0d;color:#f5f7fa;font-family:system-ui,-apple-system,sans-serif;line-height:1.6">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0b0d">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#13151a;border:1px solid #2a2e36;border-radius:14px;padding:32px">
        <tr><td>
          <h1 style="font-family:system-ui,sans-serif;font-size:20px;font-weight:500;margin:0 0 16px 0;letter-spacing:-0.02em">briven</h1>
          <h2 style="font-family:system-ui,sans-serif;font-size:18px;font-weight:500;margin:0 0 16px 0">${title}</h2>
          <div style="color:#9ba3af;font-size:15px">${body}</div>
          <p style="color:#6b7280;font-size:13px;margin-top:32px;border-top:1px solid #1e2128;padding-top:16px">
            briven · <a style="color:#9ba3af" href="https://${domain}">${domain}</a><br/>
            built with <span style="color:#e8344a">&#9829;</span> in Flanders
            &nbsp;·&nbsp; flndrn Limited, Limassol, Cyprus
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
  <style>.muted { color:#6b7280;font-size:13px }</style>
</body></html>`;
}
