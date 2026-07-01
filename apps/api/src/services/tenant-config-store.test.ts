import { describe, expect, test } from 'bun:test';

import { ValidationError } from '@briven/shared';

import {
  DEFAULT_AUTH_CONFIG,
  __authConfigSchema,
  mergeAuthConfig,
  type AuthConfig,
} from './tenant-config-store.js';

describe('tenant-config-store — pure helpers (BUILD_PLAN.md §6)', () => {
  test('DEFAULT_AUTH_CONFIG passes its own zod schema', () => {
    const parsed = __authConfigSchema.safeParse(DEFAULT_AUTH_CONFIG);
    expect(parsed.success).toBe(true);
  });

  test('DEFAULT_AUTH_CONFIG enables emailPassword and disables every other provider', () => {
    expect(DEFAULT_AUTH_CONFIG.providers.emailPassword.enabled).toBe(true);
    expect(DEFAULT_AUTH_CONFIG.providers.magicLink.enabled).toBe(false);
    expect(DEFAULT_AUTH_CONFIG.providers.emailOtp.enabled).toBe(false);
    expect(DEFAULT_AUTH_CONFIG.providers.passkey.enabled).toBe(false);
    expect(DEFAULT_AUTH_CONFIG.providers.google.enabled).toBe(false);
    expect(DEFAULT_AUTH_CONFIG.providers.github.enabled).toBe(false);
    expect(DEFAULT_AUTH_CONFIG.providers.discord.enabled).toBe(false);
    expect(DEFAULT_AUTH_CONFIG.providers.microsoft.enabled).toBe(false);
  });

  test('DEFAULT_AUTH_CONFIG carries briven brand defaults', () => {
    expect(DEFAULT_AUTH_CONFIG.branding.primaryColor).toBe('#00e87a');
    expect(DEFAULT_AUTH_CONFIG.branding.senderName).toBe('briven auth');
    expect(DEFAULT_AUTH_CONFIG.branding.senderDomain).toBeNull();
    expect(DEFAULT_AUTH_CONFIG.branding.logoUrl).toBeNull();
  });

  test('DEFAULT_AUTH_CONFIG is frozen — accidental mutation throws', () => {
    expect(() => {
      (DEFAULT_AUTH_CONFIG.providers as { emailPassword: { enabled: boolean } }).emailPassword.enabled = false;
    }).toThrow();
  });

  test('merge with empty patch returns equal config (no-op)', () => {
    const out = mergeAuthConfig(DEFAULT_AUTH_CONFIG, {});
    expect(out).toEqual(DEFAULT_AUTH_CONFIG);
  });

  test('merge applies a single provider toggle without touching others', () => {
    const out = mergeAuthConfig(DEFAULT_AUTH_CONFIG, {
      providers: { google: { enabled: true, clientId: 'gho_public_id' } },
    });
    expect(out.providers.google).toEqual({ enabled: true, clientId: 'gho_public_id' });
    expect(out.providers.github.enabled).toBe(false); // untouched
    expect(out.providers.emailPassword.enabled).toBe(true); // untouched
  });

  test('merge deep-merges branding without losing untouched keys', () => {
    const out = mergeAuthConfig(DEFAULT_AUTH_CONFIG, {
      branding: { senderDomain: 'mail.customerapp.com' },
    });
    expect(out.branding.senderDomain).toBe('mail.customerapp.com');
    // Other branding fields stay at defaults.
    expect(out.branding.primaryColor).toBe('#00e87a');
    expect(out.branding.senderName).toBe('briven auth');
    expect(out.branding.logoUrl).toBeNull();
  });

  test('merge rejects malformed primaryColor (zod regex enforces hex shape)', () => {
    expect(() =>
      mergeAuthConfig(DEFAULT_AUTH_CONFIG, {
        branding: { primaryColor: 'rgb(255,0,0)' },
      }),
    ).toThrow(ValidationError);
  });

  test('merge rejects malformed senderDomain', () => {
    expect(() =>
      mergeAuthConfig(DEFAULT_AUTH_CONFIG, {
        branding: { senderDomain: 'not a domain at all' },
      }),
    ).toThrow(ValidationError);
  });

  test('merge rejects out-of-range magicLink expiry', () => {
    expect(() =>
      mergeAuthConfig(DEFAULT_AUTH_CONFIG, {
        providers: { magicLink: { enabled: true, expiryMinutes: 999 } },
      }),
    ).toThrow(ValidationError);
  });

  test('merge rejects out-of-range otp codeLength', () => {
    expect(() =>
      mergeAuthConfig(DEFAULT_AUTH_CONFIG, {
        providers: { emailOtp: { enabled: true, codeLength: 99, expiryMinutes: 5 } },
      }),
    ).toThrow(ValidationError);
  });

  test('merge strips unknown top-level keys (zod default strip mode)', () => {
    const out = mergeAuthConfig(DEFAULT_AUTH_CONFIG, {
      unknownTopLevel: { foo: 'bar' },
      providers: { google: { enabled: true, clientId: 'x' } },
    } as unknown as Partial<AuthConfig>);
    expect('unknownTopLevel' in out).toBe(false);
    expect(out.providers.google.enabled).toBe(true);
  });

  test('merge rejects non-object patches', () => {
    expect(() => mergeAuthConfig(DEFAULT_AUTH_CONFIG, null)).toThrow(ValidationError);
    expect(() => mergeAuthConfig(DEFAULT_AUTH_CONFIG, 'not an object')).toThrow(ValidationError);
    expect(() => mergeAuthConfig(DEFAULT_AUTH_CONFIG, 42)).toThrow(ValidationError);
  });

  test('merge preserves provider isolation — toggling google does not enable github', () => {
    const out = mergeAuthConfig(DEFAULT_AUTH_CONFIG, {
      providers: { google: { enabled: true, clientId: 'a' } },
    });
    expect(out.providers.google.enabled).toBe(true);
    expect(out.providers.github.enabled).toBe(false);
    expect(out.providers.discord.enabled).toBe(false);
    expect(out.providers.microsoft.enabled).toBe(false);
  });
});
