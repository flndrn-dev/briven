import { env } from '../env.js';
import { sendTenantEmail } from '../lib/email.js';
import { log } from '../lib/logger.js';
import { recordAuthMailerFailure } from './auth-reliability.js';
import { getAuthConfig, type AuthConfig } from './tenant-config-store.js';
import { getEmailTemplate, renderTemplate, type EmailTemplateName } from './auth-email-templates.js';
import {
  buildAuthEmailFooterLines,
  getBrivenEngineBranding,
  type BrivenEngineBranding,
} from './auth-core/project-config.js';

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

// ─── shell + cta (Flanders footer — same layout as control-plane mail) ──

interface ShellArgs {
  title: string;
  body: string;
  primaryColor: string;
  senderName: string;
  logoUrl?: string | null;
  brandUrl?: string | null;
  footerNote?: string | null;
  /** Optional custom footer lines (from briven-engine branding). */
  footerLines?: string[];
}

function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const t = url.trim();
  if (t.length > 500 || /[\s"'<>]/.test(t)) return null;
  try {
    const u = new URL(t);
    if (u.protocol === 'https:') return u.toString();
    if (u.protocol === 'http:' && u.hostname === 'localhost') return u.toString();
    return null;
  } catch {
    return null;
  }
}

function shell({
  title,
  body,
  primaryColor,
  senderName,
  logoUrl,
  brandUrl,
  footerNote,
  footerLines,
}: ShellArgs): string {
  const accent = primaryColor.toLowerCase();
  const name = escapeHtml(senderName);
  const safeLogo = safeHttpUrl(logoUrl ?? null);
  const logoMark = safeLogo
    ? `<img src="${escapeHtml(safeLogo)}" alt="" width="32" height="32" style="display:block;border:0;outline:none;border-radius:8px;object-fit:contain" />`
    : `<span style="display:inline-block;width:28px;height:28px;border-radius:999px;background:${escapeHtml(accent)};box-shadow:0 0 0 3px ${escapeHtml(accent)}33"></span>`;

  let brandHref: string | null = null;
  let brandLabel: string | null = null;
  if (brandUrl?.trim()) {
    const raw = brandUrl.trim();
    if (/^https?:\/\//i.test(raw)) {
      brandHref = safeHttpUrl(raw);
      brandLabel = brandHref
        ? brandHref.replace(/^https?:\/\//i, '').replace(/\/$/, '')
        : null;
    } else if (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(raw)) {
      brandHref = `https://${raw}`;
      brandLabel = raw;
    }
  }
  const brandLine = brandHref
    ? `${name} · <a style="color:#9ba3af" href="${escapeHtml(brandHref)}">${escapeHtml(brandLabel ?? brandHref)}</a>`
    : name;
  const note = footerNote?.trim()
    ? `<p style="margin:12px 0 0 0;font-size:12px;color:#6b7280">${escapeHtml(footerNote.trim())}</p>`
    : '';

  const customHtml = (footerLines ?? [])
    .map((line) =>
      escapeHtml(line).replace(
        '♥',
        '<span style="color:#e8344a">&#9829;</span>',
      ),
    )
    .join('<br/>');
  const footerBlock = customHtml
    ? `${brandLine}<br/>${customHtml}`
    : brandLine;

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#0a0b0d;color:#f5f7fa;font-family:system-ui,-apple-system,sans-serif;line-height:1.6">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0b0d">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#13151a;border:1px solid #2a2e36;border-radius:14px;padding:32px">
        <tr><td>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0">
            <tr>
              <td style="padding-right:10px;vertical-align:middle">${logoMark}</td>
              <td style="vertical-align:middle"><span style="font-size:20px;font-weight:500;letter-spacing:-0.02em;color:#f5f7fa">${name}</span></td>
            </tr>
          </table>
          <h2 style="font-size:18px;font-weight:500;margin:0 0 12px 0;color:#f5f7fa">${escapeHtml(title)}</h2>
          <div style="font-size:15px;line-height:1.6;color:#d1d5db">${body}</div>
          ${note}
          <p style="color:#6b7280;font-size:12px;margin-top:32px;border-top:1px solid #1e2128;padding-top:16px">
            ${footerBlock}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function cta(label: string, href: string, primaryColor: string): string {
  const accent = primaryColor.toLowerCase();
  // briven brand contrast: text on accent is always #0a0b0d (dark) regardless
  // of which hex the customer picked. Their primary-color picker enforces
  // WCAG-AA against #0a0b0d (BUILD_PLAN.md §6 Branding panel).
  return `<p style="margin:0 0 24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:${accent};color:#0a0b0d;padding:12px 24px;border-radius:10px;font-weight:500;text-decoration:none">${escapeHtml(label)}</a></p>`;
}

// ─── template renderers (pure; exported for tests) ──────────────────────

export interface RenderContext {
  primaryColor: string;
  senderName: string;
  /** Public URL of the *uploaded* logo (never a free-form customer paste). */
  logoUrl?: string | null;
  /** Brand site for footer (`name · brandUrl`). */
  brandUrl?: string | null;
  footerNote?: string | null;
  footerLines?: string[];
}

export function renderMagicLink(
  ctx: RenderContext,
  args: { url: string; expiryMinutes: number },
): { subject: string; html: string; text: string } {
  return {
    subject: `your sign-in link to ${ctx.senderName}`,
    html: shell({
      title: `sign in to ${ctx.senderName}`,
      body: `
        <p style="margin:0 0 24px 0;color:#9ba3af;font-size:15px">click the button below to sign in. this link expires in ${args.expiryMinutes} minutes.</p>
        ${cta('sign in', args.url, ctx.primaryColor)}
        <p style="margin:0;color:#6b7280;font-size:13px">if you didn't request this, you can ignore this email.</p>
      `,
      primaryColor: ctx.primaryColor,
      senderName: ctx.senderName,
      logoUrl: ctx.logoUrl,
      brandUrl: ctx.brandUrl,
      footerNote: ctx.footerNote,
      footerLines: ctx.footerLines,
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
      title: `sign in to ${ctx.senderName}`,
      body: `
        <p style="margin:0 0 16px 0;color:#9ba3af;font-size:15px">enter this code to finish signing in. it expires in ${args.expiryMinutes} minutes.</p>
        <p style="margin:0 0 24px 0;font-family:ui-monospace,SFMono-Regular,monospace;font-size:28px;letter-spacing:0.35em;text-align:center;background:#1a1d24;border-radius:10px;padding:20px 16px;border:1px solid #2a2e36;color:#f5f7fa">${escapedCode}</p>
        <p style="margin:0;color:#6b7280;font-size:13px">if you didn't request this, you can ignore this email.</p>
      `,
      primaryColor: ctx.primaryColor,
      senderName: ctx.senderName,
      logoUrl: ctx.logoUrl,
      brandUrl: ctx.brandUrl,
      footerNote: ctx.footerNote,
      footerLines: ctx.footerLines,
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
      title: `verify your email for ${ctx.senderName}`,
      body: `
        <p style="margin:0 0 24px 0;color:#9ba3af;font-size:15px">click the button below to confirm this email address.</p>
        ${cta('verify email', args.url, ctx.primaryColor)}
        <p style="margin:0;color:#6b7280;font-size:13px">if you didn't request this, you can ignore this email.</p>
      `,
      primaryColor: ctx.primaryColor,
      senderName: ctx.senderName,
      logoUrl: ctx.logoUrl,
      brandUrl: ctx.brandUrl,
      footerNote: ctx.footerNote,
      footerLines: ctx.footerLines,
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
      title: `reset your ${ctx.senderName} password`,
      body: `
        <p style="margin:0 0 24px 0;color:#9ba3af;font-size:15px">click the button below to choose a new password. this link expires in 1 hour.</p>
        ${cta('reset password', args.url, ctx.primaryColor)}
        <p style="margin:0;color:#6b7280;font-size:13px">if you didn't request this, you can ignore this email. if it wasn't you, secure your account.</p>
      `,
      primaryColor: ctx.primaryColor,
      senderName: ctx.senderName,
      logoUrl: ctx.logoUrl,
      brandUrl: ctx.brandUrl,
      footerNote: ctx.footerNote,
      footerLines: ctx.footerLines,
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
      title: `new sign-in to ${ctx.senderName}`,
      body: `
        <p style="margin:0 0 16px 0;color:#9ba3af;font-size:15px">a new device just signed in to your account.</p>
        <p style="margin:0 0 24px 0;background:#1a1d24;border-radius:8px;padding:12px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:13px;color:#9ba3af;border:1px solid #2a2e36">
          ${escDevice}<br>
          at ${escWhen}
        </p>
        ${cta('manage sessions', args.manageUrl, ctx.primaryColor)}
        <p style="margin:0;color:#6b7280;font-size:13px">if this was you, no action needed. if not, revoke the session and change your password.</p>
      `,
      primaryColor: ctx.primaryColor,
      senderName: ctx.senderName,
      logoUrl: ctx.logoUrl,
      brandUrl: ctx.brandUrl,
      footerNote: ctx.footerNote,
      footerLines: ctx.footerLines,
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
    if (from === fallbackFrom) {
      // Already on the fallback — real outage. S6.3: surface for operators.
      recordAuthMailerFailure(label);
      throw err;
    }
    log.warn('tenant_sender_domain_rejected_falling_back', {
      label,
      projectId: args.projectId,
      senderDomain: config.branding.senderDomain,
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      await sendTenantEmail(label, { from: fallbackFrom, ...payload });
    } catch (err2) {
      recordAuthMailerFailure(`${label}_fallback`);
      throw err2;
    }
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
async function renderCtxForProject(
  projectId: string,
  config: AuthConfig,
): Promise<RenderContext> {
  // Prefer briven-engine branding (dashboard Auth → branding) for logo + footer.
  let engine: BrivenEngineBranding | null = null;
  try {
    engine = await getBrivenEngineBranding(projectId);
  } catch {
    engine = null;
  }
  const primaryColor =
    engine?.primaryColor ?? config.branding.primaryColor;
  const senderName = engine?.senderName ?? config.branding.senderName;
  const logoUrl = engine?.logoUrl ?? config.branding.logoUrl;
  const brandUrl = engine?.brandUrl ?? null;
  const footerNote = engine?.footerNote ?? null;
  const footerLines = engine ? buildAuthEmailFooterLines(engine) : [];
  return {
    primaryColor,
    senderName,
    logoUrl,
    brandUrl,
    footerNote,
    footerLines,
  };
}

export async function sendBrivenAuthMagicLink(
  projectId: string,
  to: string,
  url: string,
): Promise<void> {
  const config = await getAuthConfig(projectId);
  const ctx = await renderCtxForProject(projectId, config);
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
  const ctx = await renderCtxForProject(projectId, config);
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
  const ctx = await renderCtxForProject(projectId, config);
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
  const ctx = await renderCtxForProject(projectId, config);
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
  const ctx = await renderCtxForProject(projectId, config);
  const tpl = renderNewDeviceLogin(ctx, args);
  await sendForTenant('briven_auth_new_device', { projectId, to, ...tpl });
}
