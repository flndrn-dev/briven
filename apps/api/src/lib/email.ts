import { Resend } from 'resend';

import { env } from '../env.js';
import { log } from './logger.js';

/**
 * Transactional email client. Lazy-init so the API boots even without a
 * Resend key in dev. Magic-link sends throw a loud error if Resend is
 * unconfigured, rather than silently dropping the mail.
 */
let _resend: Resend | null = null;

function getResend(): Resend {
  if (!env.BRIVEN_RESEND_API_KEY) {
    throw new Error('BRIVEN_RESEND_API_KEY is not configured');
  }
  if (!_resend) _resend = new Resend(env.BRIVEN_RESEND_API_KEY);
  return _resend;
}

const FROM = env.BRIVEN_ENV === 'production' ? 'briven <auth@briven.cloud>' : 'briven dev <onboarding@resend.dev>';

export async function sendMagicLink(to: string, url: string): Promise<void> {
  // In dev without a Resend key, log the link so j can click it.
  if (!env.BRIVEN_RESEND_API_KEY) {
    log.warn('magic_link_logged_only', { host: new URL(url).host });
    process.stdout.write(`\n  magic link (dev only, paste in browser):\n  ${url}\n\n`);
    return;
  }

  const { error } = await getResend().emails.send({
    from: FROM,
    to,
    subject: 'your briven sign-in link',
    html: magicLinkHtml(url),
    text: magicLinkText(url),
  });

  if (error) {
    throw new Error(`resend send failed: ${error.message}`);
  }
}

export async function sendEmailVerification(to: string, url: string): Promise<void> {
  if (!env.BRIVEN_RESEND_API_KEY) {
    log.warn('verify_email_logged_only', { host: new URL(url).host });
    process.stdout.write(`\n  verify-email link (dev only):\n  ${url}\n\n`);
    return;
  }

  const { error } = await getResend().emails.send({
    from: FROM,
    to,
    subject: 'verify your briven email',
    html: verifyEmailHtml(url),
    text: verifyEmailText(url),
  });

  if (error) {
    throw new Error(`resend send failed: ${error.message}`);
  }
}

/*
 * Email HTML per BRAND.md §8 — dark palette, single column, primary CTA uses
 * brand green on dark-zero text. Plain-text fallback always provided.
 */

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
            briven · <a style="color:#9ba3af" href="https://briven.cloud">briven.cloud</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
  <style>.muted { color:#6b7280;font-size:13px }</style>
</body></html>`;
}
