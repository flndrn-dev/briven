/**
 * briven-engine delivery — email + SMS for OTP / magic link / password reset.
 *
 * Send order:
 *   SMS  → project Twilio-compatible secrets → else log
 *   Email → platform SMTP (BRIVEN_SMTP_*) → else log
 *
 * Product name is always briven-engine.
 */

import { log } from '../../lib/logger.js';
import { env } from '../../env.js';
import {
  getEmailSenderInfo,
  sendTransactional,
} from '../../lib/email.js';
import {
  DEFAULT_BRIVEN_ENGINE_BRANDING,
  buildAuthEmailFooterLines,
  getBrivenEngineBranding,
  getBrivenEngineSmsSecrets,
  type BrivenEngineBranding,
} from './project-config.js';

export type EmailDeliveryInput = {
  email: string;
  subject?: string;
  body?: string;
  type?: string;
  userContext?: Record<string, unknown>;
  raw?: unknown;
  /** When set, can look up per-project SMTP later */
  projectId?: string;
  /** Structured magic-link / OTP fields for the Flanders shell. */
  url?: string | null;
  code?: string | null;
  expiryMinutes?: number;
  title?: string;
  ctaLabel?: string;
};

export type SmsDeliveryInput = {
  phoneNumber: string;
  userInputCode?: string;
  urlWithLinkCode?: string;
  codeLifetime?: number;
  type?: string;
  userContext?: Record<string, unknown>;
  raw?: unknown;
  projectId?: string;
  /** Full SMS body override (e.g. dashboard test message). */
  bodyOverride?: string;
};

export type DeliveryResult = {
  ok: boolean;
  channel: 'email' | 'sms';
  engine: 'briven-engine';
  mode: 'log' | 'platform' | 'provider' | 'smtp' | 'mittera' | 'dev-stdout' | 'error';
  message?: string;
};

/** Snapshot for /v1/auth-core/info — how Auth emails leave the platform. */
export function getAuthEmailDeliveryStatus(): {
  engine: 'briven-engine';
  activeTransport: 'smtp' | 'mittera' | 'dev-stdout';
  smtpConfigured: boolean;
  mitteraConfigured: boolean;
  fromAddress: string;
  realEmailLikely: boolean;
} {
  const info = getEmailSenderInfo();
  return {
    engine: 'briven-engine',
    activeTransport: info.activeTransport,
    smtpConfigured: info.smtpFallbackConfigured,
    mitteraConfigured: info.mitteraConfigured,
    fromAddress: info.fromAddress,
    // SMTP is real delivery; mittera may accept without deliver (platform note).
    realEmailLikely: info.activeTransport === 'smtp',
  };
}

function bodyFromSms(input: SmsDeliveryInput): string {
  if (input.bodyOverride?.trim()) return input.bodyOverride.trim();
  if (input.type === 'DASHBOARD_TEST') {
    return 'Auth test: SMS is working for this project. This is not a login code.';
  }
  // Prefer project brand when callers put it on userContext.appName.
  const appName =
    typeof input.userContext?.appName === 'string' &&
    input.userContext.appName.trim()
      ? String(input.userContext.appName).trim()
      : 'your app';
  const parts = [
    input.userInputCode
      ? `Your ${appName} Auth code: ${input.userInputCode}`
      : null,
    input.urlWithLinkCode ? `Sign in: ${input.urlWithLinkCode}` : null,
    input.codeLifetime
      ? `This code expires in ${Math.round(input.codeLifetime / 1000 / 60)} minutes.`
      : null,
  ].filter(Boolean);
  return parts.join('\n') || `Your ${appName} Auth message`;
}

/** Subject lines for project Auth emails (uses dashboard branding name). */
export function authEmailSubject(
  appName: string,
  kind: 'sign-in' | 'code',
  code?: string | null,
): string {
  const name = appName.trim() || 'your app';
  if (kind === 'code') {
    const c = code?.trim();
    return c
      ? `Your ${name} Auth code: ${c}`
      : `Your ${name} Auth code`;
  }
  return `Your ${name} Auth sign-in`;
}

/**
 * Shared Briven Auth email shell — matches control-plane mail (logo + brand,
 * primary CTA / OTP, Flanders footer). Used for all project auth notifications.
 */
export function buildBrivenEngineAuthEmailHtml(input: {
  /** Plain-text body fallback (escaped). Prefer url/code when set. */
  body?: string;
  branding: BrivenEngineBranding;
  /** Magic-link URL → renders the green sign-in button. */
  url?: string | null;
  /** One-time code → large monospace block. */
  code?: string | null;
  expiryMinutes?: number;
  /** Override title; default "sign in to {brand}". */
  title?: string;
  /** CTA label when url is set. */
  ctaLabel?: string;
}): string {
  const b = input.branding;
  const color = (b.primaryColor || DEFAULT_BRIVEN_ENGINE_BRANDING.primaryColor).toLowerCase();
  const rawName = b.senderName || DEFAULT_BRIVEN_ENGINE_BRANDING.senderName;
  const name = escapeHtml(rawName);
  const title = escapeHtml(
    input.title?.trim() || `sign in to ${rawName}`,
  );
  const expiry =
    typeof input.expiryMinutes === 'number' && input.expiryMinutes > 0
      ? input.expiryMinutes
      : 10;

  const safeLogo = sanitizeLogoUrl(b.logoUrl);
  const logoMark = safeLogo
    ? `<img src="${escapeHtml(safeLogo)}" alt="" width="32" height="32" style="display:block;border:0;outline:none;border-radius:8px;object-fit:contain" />`
    : `<span style="display:inline-block;width:28px;height:28px;border-radius:999px;background:${escapeHtml(color)};box-shadow:0 0 0 3px ${escapeHtml(color)}33"></span>`;

  const brandUrl = sanitizeBrandUrl(b.brandUrl);
  const brandUrlHref = brandUrl
    ? brandUrl.startsWith('http')
      ? brandUrl
      : `https://${brandUrl}`
    : null;
  const brandUrlLabel = brandUrl
    ? brandUrl.replace(/^https?:\/\//i, '').replace(/\/$/, '')
    : null;

  // Structured content only — never dump a raw magic-link URL as the main body.
  // OTP-only → big code. Magic-link-only → button. Both → code then button.
  // Plain `body` is a last-resort fallback (password reset, generic notices).
  const chunks: string[] = [];
  if (input.code && String(input.code).trim()) {
    const code = escapeHtml(String(input.code).trim());
    chunks.push(`
          <p style="margin:0 0 16px 0;color:#9ba3af;font-size:15px;line-height:1.6">enter this code to finish signing in. it expires in ${expiry} minutes.</p>
          <p style="margin:0 0 24px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:28px;letter-spacing:0.35em;text-align:center;background:#1a1d24;border-radius:10px;padding:20px 16px;border:1px solid #2a2e36;color:#f5f7fa">${code}</p>`);
  }
  if (input.url && sanitizeLogoUrl(input.url) /* https/localhost only */) {
    const href = sanitizeLogoUrl(input.url)!;
    const label = escapeHtml(input.ctaLabel?.trim() || 'sign in');
    chunks.push(`
          <p style="margin:0 0 24px 0;color:#9ba3af;font-size:15px;line-height:1.6">click the button below to sign in. this link expires in ${expiry} minutes.</p>
          <p style="margin:0 0 24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:${escapeHtml(color)};color:#0a0b0d;padding:12px 24px;border-radius:10px;font-weight:500;font-family:system-ui,sans-serif;text-decoration:none">${label}</a></p>`);
  }
  let main = chunks.join('');
  if (!main) {
    const lines = escapeHtml(input.body ?? '')
      .split('\n')
      .map((line) => (line ? line : '&nbsp;'))
      .join('<br/>');
    main = `<div style="margin:0 0 24px 0;color:#9ba3af;font-size:15px;line-height:1.6">${lines}</div>`;
  }

  const footerNote = b.footerNote?.trim()
    ? `<p style="margin:12px 0 0 0;font-size:12px;color:#6b7280">${escapeHtml(b.footerNote.trim())}</p>`
    : '';

  const brandLine = brandUrlHref
    ? `${name} · <a style="color:#9ba3af" href="${escapeHtml(brandUrlHref)}">${escapeHtml(brandUrlLabel ?? brandUrlHref)}</a>`
    : name;

  // Custom per-project footer (no hard-coded Flanders / flndrn).
  const customLines = buildAuthEmailFooterLines(b);
  const customFooterHtml = customLines
    .map((line) => {
      // Heart glyph for "made with ♥ …"
      const htmlLine = escapeHtml(line).replace(
        '♥',
        '<span style="color:#e8344a">&#9829;</span>',
      );
      return htmlLine;
    })
    .join('<br/>');
  const footerBlock = customFooterHtml
    ? `${brandLine}<br/>${customFooterHtml}`
    : brandLine;

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><title>${title}</title></head>
<body style="margin:0;background:#0a0b0d;color:#f5f7fa;font-family:system-ui,-apple-system,sans-serif;line-height:1.6">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0b0d">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#13151a;border:1px solid #2a2e36;border-radius:14px;padding:32px">
        <tr><td>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0">
            <tr>
              <td style="padding-right:10px;vertical-align:middle">${logoMark}</td>
              <td style="vertical-align:middle"><span style="font-family:system-ui,sans-serif;font-size:20px;font-weight:500;letter-spacing:-0.02em;color:#f5f7fa">${name}</span></td>
            </tr>
          </table>
          <h2 style="font-family:system-ui,sans-serif;font-size:18px;font-weight:500;margin:0 0 12px 0;color:#f5f7fa">${title}</h2>
          ${main}
          <p style="margin:0;color:#6b7280;font-size:13px">if you didn't request this, you can ignore this email.</p>
          ${footerNote}
          <p style="color:#6b7280;font-size:12px;margin-top:32px;border-top:1px solid #1e2128;padding-top:16px">
            ${footerBlock}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Send auth email via briven-engine.
 */
export async function sendBrivenEngineEmail(
  input: EmailDeliveryInput,
): Promise<DeliveryResult> {
  const branding = input.projectId
    ? await getBrivenEngineBranding(input.projectId)
    : { ...DEFAULT_BRIVEN_ENGINE_BRANDING };
  const appName = branding.senderName || DEFAULT_BRIVEN_ENGINE_BRANDING.senderName;
  const hasCode = Boolean(input.code && String(input.code).trim());
  const hasUrl = Boolean(input.url && String(input.url).trim());
  // Prefer structured fields: OTP-only → "Auth code"; magic link → "Auth sign-in".
  const subject =
    input.subject ??
    (hasCode && !hasUrl
      ? authEmailSubject(appName, 'code', input.code)
      : authEmailSubject(appName, 'sign-in'));
  const expiry = input.expiryMinutes ?? 10;
  const defaultText = [
    hasCode ? `Your ${appName} Auth code: ${String(input.code).trim()}` : null,
    hasUrl ? `Sign in to ${appName}: ${String(input.url).trim()}` : null,
    `This expires in ${expiry} minutes. If you didn't request it, ignore this email.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const text = input.body ?? (defaultText || `${appName} message`);
  const html = buildBrivenEngineAuthEmailHtml({
    body: text,
    branding,
    // Never pass the other channel's field when callers omit it.
    url: hasUrl ? input.url : null,
    code: hasCode ? input.code : null,
    expiryMinutes: input.expiryMinutes,
    title: input.title ?? `sign in to ${appName}`,
    ctaLabel: input.ctaLabel,
  });

  log.info('briven_engine_email', {
    engine: 'briven-engine',
    to: maskEmail(input.email),
    subject,
    type: input.type,
    hasBody: Boolean(input.body),
    senderName: branding.senderName,
  });

  // Same chain as platform operator mail: SMTP → mittera → dev stdout.
  try {
    await sendTransactional('briven_engine_auth', {
      to: input.email,
      subject,
      text,
      html,
      projectId: input.projectId ?? null,
    });
    const sender = getEmailSenderInfo();
    return {
      ok: true,
      channel: 'email',
      engine: 'briven-engine',
      mode: sender.activeTransport,
      message:
        sender.activeTransport === 'smtp'
          ? 'sent via platform SMTP'
          : sender.activeTransport === 'mittera'
            ? 'sent via mittera (set BRIVEN_SMTP_* for guaranteed inbox delivery)'
            : 'logged to stdout (dev; set BRIVEN_SMTP_* for real email)',
    };
  } catch (err) {
    log.warn('briven_engine_email_send_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    if (env.BRIVEN_ENV !== 'production') {
      log.debug('briven_engine_email_dev_body', {
        email: input.email,
        bodyPreview: text.slice(0, 200),
      });
    }
    return {
      ok: false,
      channel: 'email',
      engine: 'briven-engine',
      mode: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Send auth SMS via briven-engine (Twilio-compatible HTTP when secrets present).
 *
 * Honest results:
 * - provider  → real Twilio send succeeded
 * - log       → no secrets / no project; body only logged (dev) — ok is false so UIs do not lie
 * - error     → secrets present but Twilio (or network) failed
 */
export async function sendBrivenEngineSms(
  input: SmsDeliveryInput,
): Promise<DeliveryResult> {
  const body = bodyFromSms(input);

  log.info('briven_engine_sms', {
    engine: 'briven-engine',
    phone: maskPhone(input.phoneNumber),
    type: input.type,
    hasCode: Boolean(input.userInputCode),
    hasLink: Boolean(input.urlWithLinkCode),
  });

  const projectId =
    input.projectId ??
    (typeof input.userContext?.projectId === 'string'
      ? input.userContext.projectId
      : undefined);

  if (!projectId) {
    if (env.BRIVEN_ENV !== 'production') {
      log.debug('briven_engine_sms_dev', {
        phone: input.phoneNumber,
        bodyPreview: body.slice(0, 160),
        reason: 'no_project_id',
      });
    }
    return {
      ok: false,
      channel: 'sms',
      engine: 'briven-engine',
      mode: 'log',
      message:
        'no project id for SMS — set x-briven-project-id (or project context) so Twilio secrets can load',
    };
  }

  try {
    const secrets = await getBrivenEngineSmsSecrets(projectId);
    if (!secrets) {
      if (env.BRIVEN_ENV !== 'production') {
        log.debug('briven_engine_sms_dev', {
          phone: input.phoneNumber,
          bodyPreview: body.slice(0, 160),
          reason: 'no_secrets',
        });
      }
      return {
        ok: false,
        channel: 'sms',
        engine: 'briven-engine',
        mode: 'log',
        message:
          'SMS not set for this project — save Account SID, Auth token, and From number under Authentication → Providers → SMS',
      };
    }

    const sent = await sendTwilioCompatibleSms({
      accountSid: secrets.accountSid,
      authToken: secrets.authToken,
      from: secrets.fromNumber,
      to: input.phoneNumber,
      body,
    });
    if (sent.ok) {
      return {
        ok: true,
        channel: 'sms',
        engine: 'briven-engine',
        mode: 'provider',
        message: 'sent via project SMS provider (Twilio-compatible)',
      };
    }

    log.warn('briven_engine_sms_provider_failed', { message: sent.message });
    return {
      ok: false,
      channel: 'sms',
      engine: 'briven-engine',
      mode: 'error',
      message:
        sent.message ??
        'SMS provider rejected the send — check Twilio SID, token, From number, and destination phone',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('briven_engine_sms_secrets_error', { message });
    return {
      ok: false,
      channel: 'sms',
      engine: 'briven-engine',
      mode: 'error',
      message: `SMS send failed: ${message}`,
    };
  }
}

/**
 * Dashboard “Send test SMS” — fixed body, no login code row.
 */
export async function sendBrivenEngineSmsTest(input: {
  projectId: string;
  phoneNumber: string;
}): Promise<DeliveryResult> {
  const phone = input.phoneNumber.trim();
  if (!phone.startsWith('+') || phone.replace(/\D/g, '').length < 8) {
    return {
      ok: false,
      channel: 'sms',
      engine: 'briven-engine',
      mode: 'error',
      message:
        'phone must be E.164 (start with + and country code), e.g. +15551234567',
    };
  }
  return sendBrivenEngineSms({
    phoneNumber: phone,
    projectId: input.projectId,
    type: 'DASHBOARD_TEST',
    bodyOverride:
      'Briven Auth test: SMS is working for this project. This is not a login code.',
  });
}

async function sendTwilioCompatibleSms(opts: {
  accountSid: string;
  authToken: string;
  from: string;
  to: string;
  body: string;
}): Promise<{ ok: boolean; message?: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(opts.accountSid)}/Messages.json`;
  const auth = Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString('base64');
  const form = new URLSearchParams({
    To: opts.to,
    From: opts.from,
    Body: opts.body,
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, message: `provider ${res.status}: ${t.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

function maskEmail(email: string): string {
  const [u, d] = email.split('@');
  if (!d) return '***';
  const user = u ?? '';
  return `${user.slice(0, 1)}***@${d}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Only plain https (or localhost) URLs — drop attribute-injection attempts. */
function sanitizeLogoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const t = url.trim();
  if (t.length > 500) return null;
  if (/[\s"'<>]/.test(t)) return null;
  try {
    const u = new URL(t);
    if (u.protocol === 'https:') return u.toString();
    if (u.protocol === 'http:' && u.hostname === 'localhost') return u.toString();
    return null;
  } catch {
    return null;
  }
}

/** Brand site for footer — https URL or bare domain. */
function sanitizeBrandUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const t = url.trim();
  if (t.length > 200 || /[\s"'<>]/.test(t)) return null;
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      if (u.protocol === 'https:') return u.toString().replace(/\/$/, '');
      if (u.protocol === 'http:' && u.hostname === 'localhost') {
        return u.toString().replace(/\/$/, '');
      }
      return null;
    } catch {
      return null;
    }
  }
  if (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(t)) {
    return t.toLowerCase();
  }
  return null;
}

export function passwordlessSmsDeliveryService() {
  return {
    service: {
      sendSms: async (input: {
        phoneNumber: string;
        userInputCode?: string;
        urlWithLinkCode?: string;
        codeLifetime?: number;
        type: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        userContext?: any;
      }) => {
        await sendBrivenEngineSms({
          phoneNumber: input.phoneNumber,
          userInputCode: input.userInputCode,
          urlWithLinkCode: input.urlWithLinkCode,
          codeLifetime: input.codeLifetime,
          type: input.type,
          userContext: input.userContext,
          projectId:
            typeof input.userContext?.projectId === 'string'
              ? input.userContext.projectId
              : undefined,
          raw: input,
        });
      },
    },
  };
}

export function passwordlessEmailDeliveryService() {
  return {
    service: {
      sendEmail: async (input: {
        email: string;
        userInputCode?: string;
        urlWithLinkCode?: string;
        codeLifetime?: number;
        type: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        userContext?: any;
      }) => {
        const expiryMinutes = input.codeLifetime
          ? Math.max(1, Math.round(input.codeLifetime / 1000 / 60))
          : 10;
        // Structured only: OTP emails get `code`, magic-link emails get `url`.
        // Do not force both into plain body text (that produced ugly dual emails).
        await sendBrivenEngineEmail({
          email: input.email,
          type: input.type,
          userContext: input.userContext,
          projectId:
            typeof input.userContext?.projectId === 'string'
              ? input.userContext.projectId
              : undefined,
          raw: input,
          url: input.urlWithLinkCode ?? null,
          code: input.userInputCode ?? null,
          expiryMinutes,
        });
      },
    },
  };
}
