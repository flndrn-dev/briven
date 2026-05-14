import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../env.js';
import { audit } from '../services/audit.js';
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

  // Successful POST. mittera returns the email id under `emailId`
  // (verified empirically; `id`/`messageId` are accepted as fallbacks
  // in case the API shape evolves). The id is what shows up later in
  // delivery / bounce webhook events under `messageId`, so capturing
  // it here lets an operator correlate "did my magic link ship?" with
  // "did mittera accept it / did the recipient bounce?" via grep.
  const responseBody = await res.text().catch(() => '');
  let messageId: string | null = null;
  try {
    const parsed = JSON.parse(responseBody) as {
      emailId?: string;
      id?: string;
      messageId?: string;
    };
    messageId = parsed.emailId ?? parsed.id ?? parsed.messageId ?? null;
  } catch {
    // Non-JSON body — log raw so we can see what mittera actually returned.
  }
  log.info('mittera_send_ok', {
    label,
    status: res.status,
    messageId,
    bodyPreview: messageId ? undefined : responseBody.slice(0, 240),
  });

  // Audit-log the send so operators can see it in the admin email-events
  // stream alongside inbound webhook events. Recipient is redacted per
  // CLAUDE.md §5.1; the messageId is the authoritative correlation key
  // (mittera echoes it back on delivery / bounce / complaint webhooks).
  await audit({
    actorId: null,
    projectId: null,
    action: `mittera.${label}.sent`,
    ipHash: null,
    userAgent: 'briven-api',
    metadata: {
      messageId,
      recipientRedacted: redactEmail(args.to),
      subject: args.subject,
    },
  });
}

/**
 * `flandriendev@hotmail.com` → `f•••v@h•••m`. Enough for an operator to
 * disambiguate two recent sends in the admin stream without surfacing
 * the full address. Same pattern documented in CLAUDE.md §5.1.
 * Exported for tests.
 */
export function redactEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 0) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = (s: string): string => {
    if (s.length === 0) return '';
    if (s.length === 1) return s;
    return `${s[0]}•••${s[s.length - 1]}`;
  };
  return `${head(local)}@${head(domain)}`;
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

export async function sendPasswordReset(to: string, url: string): Promise<void> {
  await send('reset_password', {
    to,
    subject: 'reset your briven password',
    html: resetPasswordHtml(url),
    text: resetPasswordText(url),
  });
}

/**
 * Confirmation that an account-deletion request was received. Sent
 * *before* the cascade runs so the user has a paper trail even if the
 * mailbox attached to the account is the one they're closing. Includes
 * the 30-day reversal window — operator support can revert within that
 * window before the hard-delete cron runs.
 */
export async function sendAccountDeletionConfirmation(to: string): Promise<void> {
  await send('account_deletion', {
    to,
    subject: 'your briven account is being deleted',
    html: accountDeletionHtml(),
    text: accountDeletionText(),
  });
}

export interface MigrationRequestEmailInput {
  requestId: string;
  source: string;
  contactEmail: string;
  sourceUrl: string | null;
  urgency: string;
  estimatedTables: number | null;
  estimatedRows: string | null;
  estimatedFunctions: number | null;
  sourceNotes: string;
}

/**
 * Confirms to the customer that their migration intake was received,
 * shows the briven request id (to quote if they email migrations@), and
 * sets the expectation for next contact (one business day).
 */
export async function sendMigrationRequestCustomerConfirmation(
  input: MigrationRequestEmailInput,
): Promise<void> {
  await send('migration_request_confirmation', {
    to: input.contactEmail,
    subject: `we got your migration request · ${input.requestId}`,
    html: migrationCustomerHtml(input),
    text: migrationCustomerText(input),
  });
}

export interface MigrationStatusUpdateInput {
  requestId: string;
  source: string;
  contactEmail: string;
  oldStatus: string;
  newStatus: string;
  operatorMessage?: string;
}

/**
 * Auto-fires whenever an operator flips a migration request's status.
 * Skipped for the transition that happens at creation (already covered
 * by the customer confirmation email). Skipped for the `new → contacted`
 * transition because the operator is about to email manually anyway —
 * a status-change email on top would arrive twice. Skipped for
 * operator-notes-only edits.
 */
export async function sendMigrationStatusUpdate(
  input: MigrationStatusUpdateInput,
): Promise<void> {
  await send('migration_status_update', {
    to: input.contactEmail,
    subject: `your migration · ${migrationStatusHeadline(input.newStatus, input.source)}`,
    html: migrationStatusUpdateHtml(input),
    text: migrationStatusUpdateText(input),
  });
}

function migrationStatusHeadline(status: string, source: string): string {
  switch (status) {
    case 'scheduled':
      return `${source} migration scheduled`;
    case 'in_progress':
      return `${source} migration in progress`;
    case 'completed':
      return `${source} migration completed`;
    case 'cancelled':
      return `${source} migration cancelled`;
    case 'contacted':
      return `we’ve reached out about your ${source} migration`;
    default:
      return `${source} migration updated`;
  }
}

/**
 * Notifies the operator inbox (default: migrations@<domain>) that a new
 * intake landed. Includes everything the customer submitted so the
 * operator can triage from the inbox without opening the dashboard for
 * the first read.
 */
export async function sendMigrationRequestOperatorAlert(
  input: MigrationRequestEmailInput,
): Promise<void> {
  const inbox =
    env.BRIVEN_MIGRATIONS_INBOX ??
    `migrations@${env.BRIVEN_DOMAIN ?? 'briven.tech'}`;
  await send('migration_request_alert', {
    to: inbox,
    subject: `new migration request · ${input.source} · ${input.urgency.replace(/_/g, ' ')}`,
    html: migrationOperatorHtml(input),
    text: migrationOperatorText(input),
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

function resetPasswordHtml(url: string): string {
  return shell(
    'reset your briven password',
    `
    <p>click below to set a new password. this link expires in 1 hour.</p>
    ${cta('reset password', url)}
    <p class="muted">if you didn't request a reset, you can ignore this email — your password stays unchanged.</p>
  `,
  );
}

function resetPasswordText(url: string): string {
  return `reset your briven password\n\n${url}\n\nthis link expires in 1 hour. if you didn't request a reset, ignore this email.`;
}

function accountDeletionHtml(): string {
  const domain = env.BRIVEN_DOMAIN ?? 'briven.tech';
  return shell(
    'your briven account is being deleted',
    `
    <p>we received your account deletion request and started the process.</p>
    <ul style="color:#9ba3af;font-size:15px;padding-left:18px">
      <li>your personal data has been cleared from our control plane (legal name, address, vat id, display name, profile picture).</li>
      <li>projects owned only by you have been soft-deleted and stop accepting traffic immediately.</li>
      <li>team orgs where you're not the only owner stay live; you've been removed from membership.</li>
      <li>api keys you owned are revoked.</li>
    </ul>
    <p>if you have a paid subscription, manage cancellation on polar via your billing portal — we don't auto-cancel.</p>
    <p>you have <strong>30 days</strong> to change your mind: email support@${domain} from this address and we can revert. after that the soft-delete becomes a hard-delete and we can't get the data back.</p>
    <p class="muted">if you did not request this, contact support@${domain} immediately.</p>
  `,
  );
}

function accountDeletionText(): string {
  const domain = env.BRIVEN_DOMAIN ?? 'briven.tech';
  return [
    'your briven account is being deleted',
    '',
    'we received your account deletion request and started the process.',
    '',
    '- personal data cleared from our control plane.',
    '- projects owned only by you soft-deleted, traffic stopped.',
    '- team orgs where you are not the sole owner stay live.',
    '- api keys revoked.',
    '',
    'if you have a paid subscription, cancel via polar billing portal — we do not auto-cancel.',
    '',
    `you have 30 days to revert: email support@${domain} from this address. after that the delete is permanent.`,
    '',
    `if you did not request this, contact support@${domain} immediately.`,
  ].join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function migrationCustomerHtml(input: MigrationRequestEmailInput): string {
  const domain = env.BRIVEN_DOMAIN ?? 'briven.tech';
  return shell(
    `we got your migration request from ${escapeHtml(input.source)}`,
    `
    <p>thanks for asking us to help move your project to briven.</p>
    <p>an operator will reach out from <code>migrations@${escapeHtml(domain)}</code> within one business day with the next steps — typically a short call to confirm scope, then the actual data + functions move while you keep running on your current platform.</p>
    <p style="background:#1a1d24;border-radius:8px;padding:12px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:13px;color:#9ba3af;border:1px solid #2a2e36">
      request id: ${escapeHtml(input.requestId)}<br/>
      source: ${escapeHtml(input.source)}<br/>
      urgency: ${escapeHtml(input.urgency.replace(/_/g, ' '))}
    </p>
    <p class="muted">your ${escapeHtml(input.source)} stays untouched. we only read from it. nothing on your source is moved or modified until you press the cutover button — which we won't do until you say so.</p>
    <p class="muted">questions or follow-ups: reply to this email, or write to migrations@${escapeHtml(domain)} and quote the request id above.</p>
  `,
  );
}

function migrationCustomerText(input: MigrationRequestEmailInput): string {
  const domain = env.BRIVEN_DOMAIN ?? 'briven.tech';
  return [
    `we got your migration request from ${input.source}`,
    '',
    'thanks for asking us to help move your project to briven. an operator will reach out within one business day with the next steps.',
    '',
    `request id: ${input.requestId}`,
    `source: ${input.source}`,
    `urgency: ${input.urgency.replace(/_/g, ' ')}`,
    '',
    `your ${input.source} stays untouched. we only read from it. nothing on your source is moved or modified until you press the cutover button.`,
    '',
    `questions or follow-ups: reply to this email, or write to migrations@${domain} and quote the request id.`,
  ].join('\n');
}

function migrationOperatorHtml(input: MigrationRequestEmailInput): string {
  const domain = env.BRIVEN_DOMAIN ?? 'briven.tech';
  return shell(
    `new migration request · ${escapeHtml(input.source)}`,
    `
    <p><strong>${escapeHtml(input.contactEmail)}</strong> requested a migration from <strong>${escapeHtml(input.source)}</strong>.</p>
    <p style="background:#1a1d24;border-radius:8px;padding:12px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:13px;color:#9ba3af;border:1px solid #2a2e36">
      request id: ${escapeHtml(input.requestId)}<br/>
      contact: ${escapeHtml(input.contactEmail)}<br/>
      source: ${escapeHtml(input.source)}<br/>
      urgency: ${escapeHtml(input.urgency.replace(/_/g, ' '))}<br/>
      source URL: ${input.sourceUrl ? escapeHtml(input.sourceUrl) : '—'}<br/>
      tables: ${input.estimatedTables ?? '—'} · rows: ${escapeHtml(input.estimatedRows ?? '—')} · functions: ${input.estimatedFunctions ?? '—'}
    </p>
    ${
      input.sourceNotes
        ? `<p style="font-family:ui-monospace,SFMono-Regular,monospace;font-size:13px;white-space:pre-wrap;background:#1a1d24;border-radius:8px;padding:12px;color:#d1d5db;border:1px solid #2a2e36">${escapeHtml(input.sourceNotes)}</p>`
        : '<p class="muted">no extra notes from the customer.</p>'
    }
    ${cta('open in admin', `https://${domain}/dashboard/admin/migrations`)}
  `,
  );
}

function statusBlurb(status: string): string {
  switch (status) {
    case 'contacted':
      return 'we’ve reached out — check your inbox for a reply with next steps.';
    case 'scheduled':
      return 'a migration window has been scheduled. you should have a calendar invite or proposed time from us.';
    case 'in_progress':
      return 'we’re moving your project right now. you’ll get another update when we’re done. your current platform stays untouched until the cutover step you control.';
    case 'completed':
      return 'your migration is complete on the briven side. open the dashboard to verify your data and run the cutover when you’re ready.';
    case 'cancelled':
      return 'we’ve cancelled this request. nothing changed on your current platform.';
    default:
      return 'status updated.';
  }
}

function migrationStatusUpdateHtml(input: MigrationStatusUpdateInput): string {
  const domain = env.BRIVEN_DOMAIN ?? 'briven.tech';
  const dashboardHref = `https://${domain}/dashboard/migrations`;
  return shell(
    migrationStatusHeadline(input.newStatus, input.source),
    `
    <p>${statusBlurb(input.newStatus)}</p>
    ${
      input.operatorMessage
        ? `<p style="background:#1a1d24;border-radius:8px;padding:12px;white-space:pre-wrap;color:#d1d5db;border:1px solid #2a2e36;font-size:14px">${escapeHtml(input.operatorMessage)}</p>`
        : ''
    }
    <p style="background:#1a1d24;border-radius:8px;padding:12px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:13px;color:#9ba3af;border:1px solid #2a2e36">
      request id: ${escapeHtml(input.requestId)}<br/>
      source: ${escapeHtml(input.source)}<br/>
      status: ${escapeHtml(input.oldStatus.replace(/_/g, ' '))} → <strong style="color:#f5f7fa">${escapeHtml(input.newStatus.replace(/_/g, ' '))}</strong>
    </p>
    ${cta('open dashboard', dashboardHref)}
    <p class="muted">need a human? reply to this email or write to migrations@${escapeHtml(domain)} and quote the request id.</p>
  `,
  );
}

function migrationStatusUpdateText(input: MigrationStatusUpdateInput): string {
  const domain = env.BRIVEN_DOMAIN ?? 'briven.tech';
  return [
    migrationStatusHeadline(input.newStatus, input.source),
    '',
    statusBlurb(input.newStatus),
    '',
    ...(input.operatorMessage ? [input.operatorMessage, ''] : []),
    `request id: ${input.requestId}`,
    `source: ${input.source}`,
    `status: ${input.oldStatus.replace(/_/g, ' ')} → ${input.newStatus.replace(/_/g, ' ')}`,
    '',
    `open dashboard: https://${domain}/dashboard/migrations`,
    '',
    `need a human? reply to this email or write to migrations@${domain}.`,
  ].join('\n');
}

function migrationOperatorText(input: MigrationRequestEmailInput): string {
  const domain = env.BRIVEN_DOMAIN ?? 'briven.tech';
  return [
    `new migration request · ${input.source}`,
    '',
    `${input.contactEmail} requested a migration from ${input.source}.`,
    '',
    `request id: ${input.requestId}`,
    `contact: ${input.contactEmail}`,
    `source: ${input.source}`,
    `urgency: ${input.urgency.replace(/_/g, ' ')}`,
    `source URL: ${input.sourceUrl ?? '—'}`,
    `tables: ${input.estimatedTables ?? '—'} · rows: ${input.estimatedRows ?? '—'} · functions: ${input.estimatedFunctions ?? '—'}`,
    '',
    'customer notes:',
    input.sourceNotes || '(none)',
    '',
    `open in admin: https://${domain}/dashboard/admin/migrations`,
  ].join('\n');
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
