import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../env.js';
import { log } from './logger.js';

/**
 * Transactional email client — talks to mittera.eu over HTTP with
 * Stripe-style HMAC-SHA256 signing on the request body. The signing
 * secret is shared with the mittera side; the same secret is used to
 * verify inbound webhooks (delivery / bounce / complaint events) at
 * the /mittera-webhook endpoint.
 *
 * Outbound request shape:
 *   POST {BRIVEN_MITTERA_API_URL}/v1/send
 *   Content-Type: application/json
 *   Mittera-Signature: t=<unix_ts>,v1=<hex_hmac_sha256>
 *   { from, to, subject, html, text }
 *
 * In dev (no signing secret configured) emails print to stdout so the
 * first-user bootstrap flow still works on a fresh self-host.
 */

const SEND_PATH = '/v1/send';

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
  return Boolean(env.BRIVEN_MITTERA_API_URL && env.BRIVEN_MITTERA_SIGNING_SECRET);
}

async function send(label: string, args: SendArgs): Promise<void> {
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

  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = signPayload(env.BRIVEN_MITTERA_SIGNING_SECRET!, ts, body);
  const url = `${env.BRIVEN_MITTERA_API_URL!.replace(/\/$/, '')}${SEND_PATH}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'mittera-signature': `t=${ts},v1=${sig}`,
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
 * Sign the canonical Stripe-style payload `<timestamp>.<body>` with
 * HMAC-SHA256, return as lowercase hex.
 */
export function signPayload(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * Verify an inbound `Mittera-Signature: t=<ts>,v1=<hex>` header against
 * the raw request body. Returns true only when the signature is valid
 * AND the timestamp is within ±5 minutes of now (replay defence).
 */
export function verifySignature(args: {
  secret: string;
  header: string | null;
  body: string;
  toleranceSec?: number;
  nowSec?: number;
}): boolean {
  if (!args.header) return false;
  const tolerance = args.toleranceSec ?? 300;
  const now = args.nowSec ?? Math.floor(Date.now() / 1000);

  // Header format: `t=<ts>,v1=<hex>` — extract the two fields.
  const parts = args.header.split(',').map((s) => s.trim());
  let ts: string | null = null;
  let v1: string | null = null;
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (k === 't' && v) ts = v;
    if (k === 'v1' && v) v1 = v;
  }
  if (!ts || !v1) return false;

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(now - tsNum) > tolerance) return false;

  const expected = signPayload(args.secret, ts, args.body);
  if (expected.length !== v1.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'));
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
