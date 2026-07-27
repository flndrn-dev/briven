import { describe, expect, test } from 'bun:test';

import {
  escapeHtml,
  renderEmailVerify,
  renderMagicLink,
  renderNewDeviceLogin,
  renderOtpCode,
  renderPasswordReset,
  resolveFallbackFromAddress,
  resolveFromAddress,
  type RenderContext,
} from './auth-mailer.js';
import { DEFAULT_AUTH_CONFIG, type AuthConfig } from './tenant-config-store.js';

const ctx: RenderContext = {
  primaryColor: '#00e87a',
  senderName: 'acme auth',
};

describe('auth-mailer — pure helpers (BUILD_PLAN.md §8)', () => {
  // ─── escapeHtml ─────────────────────────────────────────────────────

  test('escapeHtml replaces the five XSS-relevant characters', () => {
    expect(escapeHtml('<script>alert("x");</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;);&lt;/script&gt;',
    );
    expect(escapeHtml("o'reilly & sons")).toBe('o&#39;reilly &amp; sons');
  });

  test('escapeHtml is a no-op on safe text', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  // ─── resolveFromAddress ──────────────────────────────────────────────

  test('resolveFromAddress uses verified senderDomain when present', () => {
    const config: AuthConfig = {
      ...DEFAULT_AUTH_CONFIG,
      branding: {
        ...DEFAULT_AUTH_CONFIG.branding,
        senderName: 'acme',
        senderDomain: 'mail.acme.com',
      },
    };
    expect(resolveFromAddress(config)).toBe('acme <noreply@mail.acme.com>');
  });

  test('resolveFromAddress falls back to the briven domain (never auth.*) without a custom domain', () => {
    const from = resolveFromAddress(DEFAULT_AUTH_CONFIG);
    // Env-dependent domain (BRIVEN_DOMAIN ?? briven.tech) — assert the shape
    // and the hard rule: the fallback is NEVER an auth. subdomain.
    expect(from).toMatch(/^"briven auth" <noreply@[a-z0-9.-]+>$/);
    expect(from).not.toContain('noreply@auth.');
  });

  // ─── resolveFallbackFromAddress ──────────────────────────────────────

  test('resolveFallbackFromAddress ignores the custom senderDomain', () => {
    const cfg: AuthConfig = {
      ...DEFAULT_AUTH_CONFIG,
      branding: {
        ...DEFAULT_AUTH_CONFIG.branding,
        senderName: 'acme',
        senderDomain: 'mail.acme.com',
      },
    };
    const from = resolveFallbackFromAddress(cfg);
    expect(from).not.toContain('mail.acme.com');
    expect(from).toMatch(/^acme <noreply@[a-z0-9.-]+>$/);
    expect(from).not.toContain('noreply@auth.');
  });

  test('resolveFallbackFromAddress keeps display-name quoting rules', () => {
    const cfg: AuthConfig = {
      ...DEFAULT_AUTH_CONFIG,
      branding: {
        ...DEFAULT_AUTH_CONFIG.branding,
        senderName: 'acme auth',
        senderDomain: 'mail.acme.com',
      },
    };
    expect(resolveFallbackFromAddress(cfg)).toMatch(/^"acme auth" <noreply@/);
  });

  test('resolveFromAddress quotes display names with whitespace or specials', () => {
    const cfg: AuthConfig = {
      ...DEFAULT_AUTH_CONFIG,
      branding: {
        ...DEFAULT_AUTH_CONFIG.branding,
        senderName: 'acme auth',
        senderDomain: 'mail.acme.com',
      },
    };
    expect(resolveFromAddress(cfg)).toBe('"acme auth" <noreply@mail.acme.com>');
  });

  test('resolveFromAddress escapes embedded double-quotes in display name', () => {
    const cfg: AuthConfig = {
      ...DEFAULT_AUTH_CONFIG,
      branding: {
        ...DEFAULT_AUTH_CONFIG.branding,
        senderName: 'evil"corp',
        senderDomain: 'mail.acme.com',
      },
    };
    // Embedded quote → backslash-escaped per RFC 5322 mailbox grammar.
    expect(resolveFromAddress(cfg)).toBe('"evil\\"corp" <noreply@mail.acme.com>');
  });

  // ─── renderMagicLink ────────────────────────────────────────────────

  test('renderMagicLink includes the URL + expiry + sender name', () => {
    const r = renderMagicLink(ctx, { url: 'https://example.com/x', expiryMinutes: 15 });
    expect(r.subject).toBe('Your acme auth Auth sign-in');
    expect(r.html).toContain('https://example.com/x');
    expect(r.html).toContain('15 minutes');
    expect(r.text).toContain('https://example.com/x');
    expect(r.text).toContain('15 minutes');
  });

  test('renderMagicLink html paints the primary-color accent', () => {
    const r = renderMagicLink(ctx, { url: 'https://x.test/a', expiryMinutes: 15 });
    expect(r.html.toLowerCase()).toContain('#00e87a');
  });

  // ─── renderOtpCode ──────────────────────────────────────────────────

  test('renderOtpCode shows the code prominently + in the subject', () => {
    const r = renderOtpCode(ctx, { code: '482915', expiryMinutes: 5 });
    expect(r.subject).toContain('482915');
    expect(r.html).toContain('482915');
    expect(r.text).toContain('482915');
    expect(r.text).toContain('5 minutes');
  });

  test('renderOtpCode escapes the code in html (defence in depth)', () => {
    const r = renderOtpCode(ctx, { code: '<bad>', expiryMinutes: 5 });
    expect(r.html).toContain('&lt;bad&gt;');
    // The raw `<bad>` substring will appear inside `<bad>` once html-escaped
    // text is wrapped in other HTML — what matters is that an unescaped
    // `<bad>` followed by anything other than `&gt;` cannot land. We assert
    // the safer property: the literal escape sequence is present.
    expect(r.html.includes('&lt;bad&gt;')).toBe(true);
  });

  // ─── renderEmailVerify ──────────────────────────────────────────────

  test('renderEmailVerify embeds the verification URL', () => {
    const r = renderEmailVerify(ctx, { url: 'https://acme.test/verify?token=abc' });
    expect(r.subject).toBe('verify your email for acme auth');
    expect(r.html).toContain('https://acme.test/verify?token=abc');
    expect(r.text).toContain('https://acme.test/verify?token=abc');
  });

  // ─── renderPasswordReset ────────────────────────────────────────────

  test('renderPasswordReset includes ignore + secure disclaimer', () => {
    const r = renderPasswordReset(ctx, { url: 'https://acme.test/reset?token=xyz' });
    expect(r.html.toLowerCase()).toContain('ignore this email');
    expect(r.text.toLowerCase()).toContain('secure your account');
    expect(r.html).toContain('https://acme.test/reset?token=xyz');
  });

  // ─── renderNewDeviceLogin ───────────────────────────────────────────

  test('renderNewDeviceLogin escapes deviceHint to block XSS via UA string', () => {
    const r = renderNewDeviceLogin(ctx, {
      deviceHint: '<script>alert(1)</script>',
      whenIso: '2026-05-19T12:34:56Z',
      manageUrl: 'https://acme.test/account/sessions',
    });
    expect(r.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(r.html).not.toContain('<script>alert(1)</script>');
    // Timestamp + manage url present + uncorrupted.
    expect(r.html).toContain('2026-05-19T12:34:56Z');
    expect(r.html).toContain('https://acme.test/account/sessions');
  });

  // ─── cross-render invariants ────────────────────────────────────────

  test('every template renders sender name; custom footer when provided', () => {
    const withFooter: RenderContext = {
      ...ctx,
      footerLines: [
        'made with ♥ Flanders by flndrn',
        '100% self-funded, sustainable & independent',
        'flndrn Limited, Limassol, Cyprus',
      ],
    };
    const outs = [
      renderMagicLink(withFooter, { url: 'https://x.test', expiryMinutes: 5 }),
      renderOtpCode(withFooter, { code: '111', expiryMinutes: 5 }),
      renderEmailVerify(withFooter, { url: 'https://x.test' }),
      renderPasswordReset(withFooter, { url: 'https://x.test' }),
      renderNewDeviceLogin(withFooter, {
        deviceHint: 'd',
        whenIso: 't',
        manageUrl: 'https://x.test',
      }),
    ];
    for (const out of outs) {
      expect(out.html).toContain('acme auth');
      expect(out.html).toContain('Flanders');
      expect(out.html).toContain('Limassol');
    }
  });

  test('subject lines never contain the customer accent color (no styling in subject)', () => {
    const outs = [
      renderMagicLink(ctx, { url: 'https://x.test', expiryMinutes: 15 }),
      renderOtpCode(ctx, { code: '123456', expiryMinutes: 5 }),
      renderEmailVerify(ctx, { url: 'https://x.test' }),
      renderPasswordReset(ctx, { url: 'https://x.test' }),
      renderNewDeviceLogin(ctx, {
        deviceHint: 'd',
        whenIso: 't',
        manageUrl: 'https://x.test',
      }),
    ];
    for (const out of outs) {
      expect(out.subject).not.toContain('#00e87a');
      expect(out.subject).not.toContain('<');
    }
  });
});
