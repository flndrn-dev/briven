import { describe, expect, test } from 'bun:test';

import {
  AUTH_BRIDGE_TOOLS,
  AUTH_GUIDANCE,
  matchAuthGuidance,
  sanitizeAuthConfig,
  tokeniseQuestion,
} from './mcp-auth-bridge.js';
import { DEFAULT_AUTH_CONFIG, type AuthConfig } from './tenant-config-store.js';

describe('mcp auth bridge — pure helpers', () => {
  /* ── sanitizeAuthConfig ────────────────────────────────────────────── */

  test('sanitizeAuthConfig replaces OAuth clientId values with a boolean', () => {
    const cfg: AuthConfig = {
      ...DEFAULT_AUTH_CONFIG,
      providers: {
        ...DEFAULT_AUTH_CONFIG.providers,
        google: { enabled: true, clientId: 'g-123-secret-ish.apps.example' },
        github: { enabled: false, clientId: null },
      },
    };
    const out = sanitizeAuthConfig(cfg);
    expect(out.providers.google).toEqual({ enabled: true, clientIdSet: true });
    expect(out.providers.github).toEqual({ enabled: false, clientIdSet: false });
    expect(JSON.stringify(out)).not.toContain('g-123-secret-ish');
  });

  test('sanitizeAuthConfig keeps non-clientId provider settings and branding', () => {
    const out = sanitizeAuthConfig(DEFAULT_AUTH_CONFIG);
    expect(out.providers.magicLink).toHaveProperty('enabled');
    expect(out.providers.magicLink).toHaveProperty('expiryMinutes');
    expect(out.branding).toHaveProperty('senderName');
    expect(out.branding).toHaveProperty('senderDomain');
  });

  /* ── matchAuthGuidance ─────────────────────────────────────────────── */

  test('fallback-sender question surfaces the fallback guidance first', () => {
    const matches = matchAuthGuidance('why do my emails still come from noreply@briven.tech?');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.id).toBe('emails-from-fallback');
  });

  test('sender-domain question finds sender-domain guidance', () => {
    const ids = matchAuthGuidance('how do I set a custom sender domain for my emails').map(
      (m) => m.id,
    );
    expect(ids).toContain('sender-domain-setup');
  });

  test('2FA / backup code question hits two-factor guidance', () => {
    const ids = matchAuthGuidance('lost phone how do backup recovery codes work for 2fa').map(
      (m) => m.id,
    );
    expect(ids).toContain('two-factor-backup-codes');
  });

  test('e2e testing token question hits testing-tokens guidance', () => {
    const ids = matchAuthGuidance('how do I use a testing token for playwright e2e ci').map(
      (m) => m.id,
    );
    expect(ids).toContain('testing-tokens-e2e');
  });

  test('scaffold question hits scaffold-setup guidance', () => {
    const ids = matchAuthGuidance('briven auth scaffold next middleware setup').map((m) => m.id);
    expect(ids).toContain('scaffold-setup');
  });

  test('passkey 404 / Face ID question hits passkey-webauthn guidance', () => {
    const ids = matchAuthGuidance(
      'passkey generate authenticate options returns 404 is Face ID waiting on platform',
    ).map((m) => m.id);
    expect(ids).toContain('passkey-webauthn');
  });

  test('magic link HTTP 500 empty body hits magic-otp-500 guidance', () => {
    const ids = matchAuthGuidance(
      'POST magic link returns HTTP 500 empty body what is broken',
    ).map((m) => m.id);
    expect(ids).toContain('magic-otp-500');
  });

  test('OAuth toggle without secrets hits providers-config', () => {
    const ids = matchAuthGuidance(
      'google provider enabled but oauth needs client id and secret',
    ).map((m) => m.id);
    expect(ids).toContain('providers-config');
  });

  test('passkey guidance teaches GET options and real Face ID on device', () => {
    const entry = AUTH_GUIDANCE.find((e) => e.id === 'passkey-webauthn')!;
    const a = entry.answer.toLowerCase();
    expect(a).toContain('get /passkey/generate-authenticate-options');
    expect(a).toContain('404 by design');
    expect(a).toContain('device');
  });

  test('unrelated question returns no matches', () => {
    expect(matchAuthGuidance('kubernetes ingress annotations')).toEqual([]);
  });

  test('every guidance entry carries apply-steps and a docs citation', () => {
    for (const entry of AUTH_GUIDANCE) {
      expect(entry.applyInYourProject.length).toBeGreaterThan(0);
      expect(entry.docs).toStartWith('https://docs.briven.tech/');
    }
  });

  test('guidance prose never names the email vendor', () => {
    const blob = JSON.stringify(AUTH_GUIDANCE).toLowerCase();
    expect(blob).not.toContain('mittera');
  });

  /* ── misc ──────────────────────────────────────────────────────────── */

  test('tokeniseQuestion lowercases and drops single characters', () => {
    expect(tokeniseQuestion('Why DO x emails FAIL?')).toEqual(['why', 'do', 'emails', 'fail']);
  });

  test('AUTH_BRIDGE_TOOLS lists exactly the three v1 tools', () => {
    expect([...AUTH_BRIDGE_TOOLS].sort()).toEqual([
      'auth_config_get',
      'auth_docs_ask',
      'sender_domain_status',
    ]);
  });
});
