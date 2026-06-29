import { describe, expect, test } from 'bun:test';

import { ValidationError } from '@briven/shared';

import {
  DEFAULT_AUTH_CONFIG,
  __authConfigSchema,
  __customOidcSchema,
  buildAuthBrandingPublicPayload,
  computeEnabledProviders,
  mergeAuthConfig,
  type AuthConfig,
  type CustomOidcProvider,
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

// ─── custom OIDC schema ──────────────────────────────────────────────────

function oidc(overrides: Partial<CustomOidcProvider> = {}): CustomOidcProvider {
  return {
    id: 'acme-sso',
    displayName: 'Acme SSO',
    enabled: true,
    clientId: 'acme-public-client-id',
    issuer: 'https://issuer.example.com',
    authorizationUrl: null,
    tokenUrl: null,
    userinfoUrl: null,
    scopes: 'openid profile email',
    pkce: true,
    ...overrides,
  };
}

describe('custom-OIDC schema (__customOidcSchema)', () => {
  test('DEFAULT_AUTH_CONFIG carries an empty customOidc array', () => {
    expect(DEFAULT_AUTH_CONFIG.customOidc).toEqual([]);
  });

  test('accepts a well-formed issuer-based entry and defaults scopes', () => {
    const parsed = __customOidcSchema.safeParse({
      id: 'acme-sso',
      displayName: 'Acme SSO',
      enabled: true,
      clientId: 'cid',
      issuer: 'https://issuer.example.com',
      authorizationUrl: null,
      tokenUrl: null,
      userinfoUrl: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.scopes).toBe('openid profile email');
  });

  test('rejects a non-slug id (uppercase / spaces)', () => {
    expect(__customOidcSchema.safeParse(oidc({ id: 'Acme SSO' })).success).toBe(false);
    expect(__customOidcSchema.safeParse(oidc({ id: 'ACME' })).success).toBe(false);
  });

  test('rejects a non-URL issuer', () => {
    expect(__customOidcSchema.safeParse(oidc({ issuer: 'not-a-url' })).success).toBe(false);
  });

  test('mergeAuthConfig accepts a customOidc array (whole-array replace)', () => {
    const out = mergeAuthConfig(DEFAULT_AUTH_CONFIG, { customOidc: [oidc()] });
    expect(out.customOidc).toHaveLength(1);
    expect(out.customOidc?.[0]?.id).toBe('acme-sso');
  });

  test('old configs without customOidc still parse (optional field)', () => {
    const withoutOidc = { ...DEFAULT_AUTH_CONFIG } as Record<string, unknown>;
    delete withoutOidc.customOidc;
    expect(__authConfigSchema.safeParse(withoutOidc).success).toBe(true);
  });
});

// ─── enabled-providers gate + public payload (render-gating) ─────────────

function configWithProviders(over: Partial<AuthConfig['providers']>, customOidc: CustomOidcProvider[] = []): AuthConfig {
  return {
    ...DEFAULT_AUTH_CONFIG,
    providers: { ...DEFAULT_AUTH_CONFIG.providers, ...over },
    customOidc,
  };
}

describe('computeEnabledProviders — the single enable gate', () => {
  test('lists only providers that are enabled AND have a clientId AND a secret', () => {
    const config = configWithProviders({
      google: { enabled: true, clientId: 'g-cid' }, // has secret below → enabled
      github: { enabled: true, clientId: 'gh-cid' }, // NO secret → excluded
      discord: { enabled: false, clientId: 'd-cid' }, // disabled → excluded
      microsoft: { enabled: true, clientId: null }, // no clientId → excluded
    });
    const has = (name: string) => name === 'google_client_secret';
    expect(computeEnabledProviders(config, has)).toEqual(['google']);
  });

  test('includes a fully-configured custom-OIDC id and excludes half-configured ones', () => {
    const config = configWithProviders({}, [
      oidc({ id: 'ready', clientId: 'cid' }), // issuer + clientId + secret → in
      oidc({ id: 'no-secret', clientId: 'cid' }), // secret missing → out
      oidc({ id: 'no-endpoints', clientId: 'cid', issuer: null }), // no issuer/endpoints → out
      oidc({ id: 'disabled', clientId: 'cid', enabled: false }), // disabled → out
    ]);
    const has = (name: string) =>
      name === 'oidc_ready_client_secret' ||
      name === 'oidc_no-endpoints_client_secret' ||
      name === 'oidc_disabled_client_secret';
    expect(computeEnabledProviders(config, has)).toEqual(['ready']);
  });

  test('custom-OIDC with explicit endpoints (no issuer) counts as having endpoints', () => {
    const config = configWithProviders({}, [
      oidc({
        id: 'explicit',
        clientId: 'cid',
        issuer: null,
        authorizationUrl: 'https://i.example.com/authorize',
        tokenUrl: 'https://i.example.com/token',
        userinfoUrl: 'https://i.example.com/userinfo',
      }),
    ]);
    const has = (name: string) => name === 'oidc_explicit_client_secret';
    expect(computeEnabledProviders(config, has)).toEqual(['explicit']);
  });
});

describe('buildAuthBrandingPublicPayload — never leaks secrets/clientIds', () => {
  test('returns only enabled providers + safe presentation fields', () => {
    const config = configWithProviders(
      { google: { enabled: true, clientId: 'g-cid-SENSITIVE' } },
      [oidc({ id: 'acme', clientId: 'acme-cid-SENSITIVE' })],
    );
    const enabled = ['google', 'acme'];
    const payload = buildAuthBrandingPublicPayload(config, enabled);

    expect(payload.socialProviders).toEqual(['google', 'acme']);
    expect(payload.primaryColor).toBe(config.branding.primaryColor);
    expect(payload.senderName).toBe(config.branding.senderName);
    // OIDC display label is exposed (needed for the button) but nothing else.
    expect(payload.customOidc).toEqual([{ id: 'acme', displayName: 'Acme SSO' }]);

    // The serialized payload must NOT contain ANY clientId, endpoint, or toggle.
    const json = JSON.stringify(payload);
    expect(json).not.toContain('g-cid-SENSITIVE');
    expect(json).not.toContain('acme-cid-SENSITIVE');
    expect(json).not.toContain('issuer.example.com');
    expect(json).not.toContain('clientId');
  });

  test('only enabled custom-OIDC entries surface their display label', () => {
    const config = configWithProviders({}, [
      oidc({ id: 'on', displayName: 'On SSO' }),
      oidc({ id: 'off', displayName: 'Off SSO' }),
    ]);
    const payload = buildAuthBrandingPublicPayload(config, ['on']);
    expect(payload.customOidc).toEqual([{ id: 'on', displayName: 'On SSO' }]);
  });
});
