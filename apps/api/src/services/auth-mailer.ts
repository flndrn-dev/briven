import { env } from '../env.js';
import { sendTenantEmail } from '../lib/email.js';
import { log } from '../lib/logger.js';
import { getAuthConfig, type AuthConfig } from './tenant-config-store.js';
import { getEmailTemplate, renderTemplate, type EmailTemplateName } from './auth-email-templates.js';

/**
 * briven auth per-tenant email pipeline (BUILD_PLAN.md §8).
 *
 * Five customer-facing template renderers + their `send*` wrappers. The
 * renderers are pure — no I/O, no zod, no postgres — so they unit-test
 * cheaply. The wrappers resolve per-tenant branding via
 * `getAuthConfig(projectId)`, render with the tenant's primary color +
 * sender name, and dispatch via `sendTenantEmail` (lib/email.ts).
 *
 * Sender resolution (per BUILD_PLAN.md §8):
 *   - tenant has a `senderDomain`  → `"${senderName}" <noreply@${senderDomain}>`
 *   - no custom domain             → `briven auth <noreply@${BRIVEN_DOMAIN}>`
 *   - custom domain REJECTED at send time (provider hasn't verified it)
 *     → retry once from the fallback sender. A half-configured domain must
 *     never break a tenant's login flow (konnos magic-link 500, 2026-07-07).
 *
 * The fallback domain MUST be a sender verified with the email provider
 * (mittera.eu / SMTP). It tracks `BRIVEN_DOMAIN` (briven.tech) — the SAME
 * verified address the control-plane sender uses (lib/email.ts `fromAddress`)
 * — NOT a bare `auth.` subdomain. The old `auth.briven.tech` fallback was
 * never verified in mittera, so every tenant send on the fallback was
 * rejected instantly with a 500 (broke Konnos magic-link, 2026-07-05).
 *
 * Templates are dark-themed by default to match the briven brand. Every
 * template includes a "you didn't request this" disclaimer to soften the
 * impact of a misdirected send.
 */

const FALLBACK_DOMAIN = env.BRIVEN_DOMAIN ?? 'briven.tech';

// ─── pure HTML escape (no DOM, no library) ──────────────────────────────

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── shell + cta with per-tenant primary color ──────────────────────────

interface ShellArgs {
  title: string;
  body: string;
  primaryColor: string;
  senderName: string;
}

function shell({ title, body, primaryColor, senderName }: ShellArgs): string {
  // Inline-styled for max email-client compatibility. Dark-themed defaults
  // per BRAND.md §3; primary color is the only per-tenant variable.
  const accent = primaryColor.toLowerCase();
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0a0b0d;color:#f5f7fa;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px">
    <h1 style="font-size:20px;font-weight:600;margin:0 0 24px;color:#f5f7fa">${escapeHtml(title)}</h1>
    <div style="font-size:15px;line-height:1.5;color:#d1d5db">${body}</div>
    <hr style="border:none;border-top:1px solid #2a2e36;margin:32px 0">
    <p style="font-size:12px;color:#6b7280;margin:0">${escapeHtml(senderName)} · powered by <span style="color:${accent}">briven auth</span></p>
  </div>
</body></html>`;
}

function cta(label: string, href: string, primaryColor: string): string {
  const accent = primaryColor.toLowerCase();
  // briven brand contrast: text on accent is always #0a0b0d (dark) regardless
  // of which hex the customer picked. Their primary-color picker enforces
  // WCAG-AA against #0a0b0d (BUILD_PLAN.md §6 Branding panel).
  return `<p style="margin:32px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:${accent};color:#0a0b0d;padding:12px 24px;border-radius:10px;font-weight:500;text-decoration:none">${escapeHtml(label)}</a></p>`;
}

// ─── template renderers (pure; exported for tests) ──────────────────────

export interface RenderContext {
  primaryColor: string;
  senderName: string;
}

export function renderMagicLink(
  ctx: RenderContext,
  args: { url: string; expiryMinutes: number },
): { subject: string; html: string; text: string } {
  return {
    subject: `your sign-in link to ${ctx.senderName}`,
    html: shell({
      title: 'sign in',
      body: `
        <p>click below to sign in. this link expires in ${args.expiryMinutes} minutes.</p>
        ${cta('sign in', args.url, ctx.primaryColor)}
        <p style="color:#6b7280;font-size:13px">if you didn't request this, ignore the email — nothing happens.</p>
      `,
      primaryColor: ctx.primaryColor,
      senderName: ctx.senderName,
    }),
    text: `sign in to ${ctx.senderName}\n\n${args.url}\n\nthis link expires in ${args.expiryMinutes} minutes. if you didn't request it, ignore this email.`,
  };
}

export function renderOtpCode(
  ctx: RenderContext,
  args: { code: string; expiryMinutes: number },
): { subject: string; html: string; text: string } {
  const escapedCode = escapeHtml(args.code);
  return {
    subject: `your ${ctx.senderName} sign-in code: ${args.code}`,
    html: shell({
      title: 'one-time code',
      body: `
        <p>enter this code to finish signing in. it expires in ${args.expiryMinutes} minutes.</p>
        <p style="font-family:ui-monospace,SFMono-Regular,monospace;font-size:32px;letter-spacing:8px;text-align:center;background:#1a1d24;border-radius:10px;padding:24px;border:1px solid #2a2e36;color:#f5f7fa">${escapedCode}</p>
        <p style="color:#6b7280;font-size:13px">if you didn't request this, someone may have typed your email by mistake. you can ignore it safely.</p>
      `,
      primaryColor: ctx.primaryColor,
      senderName: ctx.senderName,
    }),
    text: `sign in to ${ctx.senderName}\n\nyour code: ${args.code}\n\nthis code expires in ${args.expiryMinutes} minutes. if you didn't request it, ignore this email.`,
  };
}

export function renderEmailVerify(
  ctx: RenderContext,
  args: { url: string },
): { subject: string; html: string; text: string } {
  return {
    subject: `verify your email for ${ctx.senderName}`,
    html: shell({
      title: 'verify your email',
      body: `
        <p>click below to confirm this email address.</p>
        ${cta('verify email', args.url, ctx.primaryColor)}
        <p style="color:#6b7280;font-size:13px">if you didn't sign up, ignore the email.</p>
      `,
      primaryColor: ctx.primaryColor,
      senderName: ctx.senderName,
    }),
    text: `verify your email for ${ctx.senderName}\n\n${args.url}\n\nif you didn't sign up, ignore this email.`,
  };
}

export function renderPasswordReset(
  ctx: RenderContext,
  args: { url: string },
): { subject: string; html: string; text: string } {
  return {
    subject: `reset your ${ctx.senderName} password`,
    html: shell({
      title: 'reset your password',
      body: `
        <p>click below to choose a new password. this link expires in 1 hour.</p>
        ${cta('reset password', args.url, ctx.primaryColor)}
        <p style="color:#6b7280;font-size:13px">if you didn't request this, secure your account: change your password and review active sessions.</p>
      `,
      primaryColor: ctx.primaryColor,
      senderName: ctx.senderName,
    }),
    text: `reset your ${ctx.senderName} password\n\n${args.url}\n\nthis link expires in 1 hour. if you didn't request this, secure your account.`,
  };
}

export function renderNewDeviceLogin(
  ctx: RenderContext,
  args: { deviceHint: string; whenIso: string; manageUrl: string },
): { subject: string; html: string; text: string } {
  // deviceHint format: "Firefox on macOS, Antwerp BE" — pre-redacted at
  // the call site so this template doesn't see raw IPs (CLAUDE.md §5.1).
  const escDevice = escapeHtml(args.deviceHint);
  const escWhen = escapeHtml(args.whenIso);
  return {
    subject: `new sign-in to ${ctx.senderName}`,
    html: shell({
      title: 'new device signed in',
      body: `
        <p>a new device just signed in to your account.</p>
        <p style="background:#1a1d24;border-radius:8px;padding:12px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:13px;color:#9ba3af;border:1px solid #2a2e36">
          ${escDevice}<br>
          at ${escWhen}
        </p>
        ${cta('manage sessions', args.manageUrl, ctx.primaryColor)}
        <p style="color:#6b7280;font-size:13px">if this was you, no action needed. if not, revoke the session immediately and change your password.</p>
      `,
      primaryColor: ctx.primaryColor,
      senderName: ctx.senderName,
    }),
    text: `new sign-in to ${ctx.senderName}\n\n${args.deviceHint}\nat ${args.whenIso}\n\nmanage: ${args.manageUrl}\n\nif this wasn't you, revoke the session and change your password.`,
  };
}

// ─── tenant-aware sender ────────────────────────────────────────────────

/**
 * Build the From: header for a tenant. Custom domain → tenant-branded
 * sender. No custom domain → briven-fallback so first-day customers
 * can still send while their DNS propagates.
 */
export function resolveFromAddress(config: AuthConfig): string {
  return formatFrom(config.branding.senderName, config.branding.senderDomain ?? FALLBACK_DOMAIN);
}

/**
 * The From: header a tenant send retries with when the custom
 * `senderDomain` is rejected by the email provider (not yet verified
 * there). Keeps the tenant's display name, swaps only the domain.
 */
export function resolveFallbackFromAddress(config: AuthConfig): string {
  return formatFrom(config.branding.senderName, FALLBACK_DOMAIN);
}

function formatFrom(senderName: string, domain: string): string {
  // Quote the display name when it contains characters that would
  // otherwise break the RFC 5322 mailbox grammar (spaces, ".", etc).
  const needsQuote = /[\s",;:<>@()\\[\]]/.test(senderName);
  const display = needsQuote ? `"${senderName.replace(/"/g, '\\"')}"` : senderName;
  return `${display} <noreply@${domain}>`;
}

interface TenantSendArgs {
  projectId: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function sendForTenant(label: string, args: TenantSendArgs): Promise<void> {
  const config = await getAuthConfig(args.projectId);
  const from = resolveFromAddress(config);
  const payload = {
    projectId: args.projectId,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
  };
  try {
    await sendTenantEmail(label, { from, ...payload });
  } catch (err) {
    // A custom senderDomain that the email provider hasn't verified is
    // rejected at send time. That must NEVER break the tenant's login
    // flow (it 500'd konnos magic-link, 2026-07-07) — retry once from
    // the always-verified briven fallback sender instead.
    const fallbackFrom = resolveFallbackFromAddress(config);
    if (from === fallbackFrom) throw err; // already on the fallback — a real outage, surface it
    log.warn('tenant_sender_domain_rejected_falling_back', {
      label,
      projectId: args.projectId,
      senderDomain: config.branding.senderDomain,
      error: err instanceof Error ? err.message : String(err),
    });
    await sendTenantEmail(label, { from: fallbackFrom, ...payload });
  }
}

// ─── custom template helper ─────────────────────────────────────────────

async function maybeUseCustomTemplate(
  projectId: string,
  name: EmailTemplateName,
  vars: Record<string, string>,
  fallback: () => { subject: string; html: string; text: string },
): Promise<{ subject: string; html: string; text: string }> {
  const custom = await getEmailTemplate(projectId, name);
  if (custom) {
    const rendered = renderTemplate(custom, vars);
    return {
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text ?? fallback().text,
    };
  }
  return fallback();
}

// ─── Better Auth callback shape ─────────────────────────────────────────

/**
 * Send a magic-link email. Resolves brand + sender from the tenant's
 * config. Used by Better Auth's `magicLink` plugin's `sendMagicLink`
 * callback (wired in `auth-tenant-pool.ts` when the plugin is enabled).
 */
export async function sendBrivenAuthMagicLink(
  projectId: string,
  to: string,
  url: string,
): Promise<void> {
  const config = await getAuthConfig(projectId);
  const ctx: RenderContext = {
    primaryColor: config.branding.primaryColor,
    senderName: config.branding.senderName,
  };
  const tpl = await maybeUseCustomTemplate(
    projectId,
    'magic-link',
    { url, expiryMinutes: String(config.providers.magicLink.expiryMinutes), appName: ctx.senderName },
    () => renderMagicLink(ctx, { url, expiryMinutes: config.providers.magicLink.expiryMinutes }),
  );
  await sendForTenant('briven_auth_magic_link', { projectId, to, ...tpl });
}

export async function sendBrivenAuthOtp(
  projectId: string,
  to: string,
  code: string,
): Promise<void> {
  const config = await getAuthConfig(projectId);
  const ctx: RenderContext = {
    primaryColor: config.branding.primaryColor,
    senderName: config.branding.senderName,
  };
  const tpl = await maybeUseCustomTemplate(
    projectId,
    'otp',
    { code, expiryMinutes: String(config.providers.emailOtp.expiryMinutes), appName: ctx.senderName },
    () => renderOtpCode(ctx, { code, expiryMinutes: config.providers.emailOtp.expiryMinutes }),
  );
  await sendForTenant('briven_auth_otp', { projectId, to, ...tpl });
}

export async function sendBrivenAuthEmailVerification(
  projectId: string,
  to: string,
  url: string,
): Promise<void> {
  const config = await getAuthConfig(projectId);
  const ctx: RenderContext = {
    primaryColor: config.branding.primaryColor,
    senderName: config.branding.senderName,
  };
  const tpl = await maybeUseCustomTemplate(
    projectId,
    'verification',
    { url, appName: ctx.senderName },
    () => renderEmailVerify(ctx, { url }),
  );
  await sendForTenant('briven_auth_email_verify', { projectId, to, ...tpl });
}

export async function sendBrivenAuthPasswordReset(
  projectId: string,
  to: string,
  url: string,
): Promise<void> {
  const config = await getAuthConfig(projectId);
  const ctx: RenderContext = {
    primaryColor: config.branding.primaryColor,
    senderName: config.branding.senderName,
  };
  const tpl = await maybeUseCustomTemplate(
    projectId,
    'password-reset',
    { url, appName: ctx.senderName },
    () => renderPasswordReset(ctx, { url }),
  );
  await sendForTenant('briven_auth_password_reset', { projectId, to, ...tpl });
}

export async function sendBrivenAuthNewDeviceLogin(
  projectId: string,
  to: string,
  args: { deviceHint: string; whenIso: string; manageUrl: string },
): Promise<void> {
  const config = await getAuthConfig(projectId);
  const ctx: RenderContext = {
    primaryColor: config.branding.primaryColor,
    senderName: config.branding.senderName,
  };
  const tpl = renderNewDeviceLogin(ctx, args);
  await sendForTenant('briven_auth_new_device', { projectId, to, ...tpl });
}
