/**
 * Unit tests for the Phase 3 (Auth Product) per-tenant Better Auth wiring:
 *   - buildTenantAuthPlugins  → loads magic-link + email-OTP plugins per config
 *   - buildAuthDatabaseHooks  → fans lifecycle events to an (injected) dispatch
 *   - resetPasswordUrl        → the hosted new-password reset-link contract
 *
 * Pure / dependency-injected on purpose — no real Better Auth, no postgres, no
 * email — so these run without BRIVEN_DATA_PLANE_URL or any live DB.
 */
import { describe, expect, test } from 'bun:test';

import {
  buildAuthDatabaseHooks,
  buildGenericOAuthConfigs,
  buildTenantAuthPlugins,
  hostedAuthBaseUrl,
  resetPasswordUrl,
  type AuthEventDispatcher,
} from './auth-tenant-pool.js';
import {
  DEFAULT_AUTH_CONFIG,
  type AuthConfig,
  type CustomOidcProvider,
} from './tenant-config-store.js';

const PROJECT_ID = 'p_test123';

function configWith(overrides: Partial<AuthConfig['providers']>): AuthConfig {
  return {
    ...DEFAULT_AUTH_CONFIG,
    providers: { ...DEFAULT_AUTH_CONFIG.providers, ...overrides },
  };
}

// A tiny recording dispatcher so we can assert what the hooks fire.
function recorder(): {
  dispatch: AuthEventDispatcher;
  calls: Array<{ projectId: string; eventType: string; payload: Record<string, unknown> }>;
} {
  const calls: Array<{
    projectId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }> = [];
  const dispatch: AuthEventDispatcher = (projectId, eventType, payload) => {
    calls.push({ projectId, eventType, payload });
  };
  return { dispatch, calls };
}

describe('buildTenantAuthPlugins — config-gated plugin loading', () => {
  test('loads no extra plugins when magic-link + email-OTP + passkey are disabled', () => {
    const plugins = buildTenantAuthPlugins(PROJECT_ID, DEFAULT_AUTH_CONFIG);
    const ids = plugins.map((p) => p.id);
    expect(ids).not.toContain('magic-link');
    expect(ids).not.toContain('email-otp');
    expect(ids).not.toContain('passkey');
  });

  test('loads the passkey plugin when enabled', () => {
    const config = configWith({ passkey: { enabled: true } });
    const ids = buildTenantAuthPlugins(PROJECT_ID, config).map((p) => p.id);
    expect(ids).toContain('passkey');
    expect(ids).not.toContain('magic-link');
    expect(ids).not.toContain('email-otp');
  });

  test('loads the magic-link plugin when enabled', () => {
    const config = configWith({ magicLink: { enabled: true, expiryMinutes: 15 } });
    const ids = buildTenantAuthPlugins(PROJECT_ID, config).map((p) => p.id);
    expect(ids).toContain('magic-link');
    expect(ids).not.toContain('email-otp');
  });

  test('loads the email-OTP plugin when enabled', () => {
    const config = configWith({
      emailOtp: { enabled: true, codeLength: 6, expiryMinutes: 5 },
    });
    const ids = buildTenantAuthPlugins(PROJECT_ID, config).map((p) => p.id);
    expect(ids).toContain('email-otp');
    expect(ids).not.toContain('magic-link');
  });

  test('loads both plugins when both are enabled', () => {
    const config = configWith({
      magicLink: { enabled: true, expiryMinutes: 15 },
      emailOtp: { enabled: true, codeLength: 6, expiryMinutes: 5 },
    });
    const ids = buildTenantAuthPlugins(PROJECT_ID, config).map((p) => p.id);
    expect(ids).toContain('magic-link');
    expect(ids).toContain('email-otp');
  });
});

describe('buildAuthDatabaseHooks — lifecycle webhook dispatch', () => {
  test('user.create.after fires auth.signup with a minimal payload', async () => {
    const { dispatch, calls } = recorder();
    const hooks = buildAuthDatabaseHooks(PROJECT_ID, dispatch);
    const createdAt = new Date('2026-06-29T00:00:00.000Z');

    await hooks.user!.create!.after!(
      { id: 'u_1', email: 'a@b.com', createdAt } as never,
      null,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.projectId).toBe(PROJECT_ID);
    expect(calls[0]!.eventType).toBe('auth.signup');
    expect(calls[0]!.payload).toEqual({
      userId: 'u_1',
      email: 'a@b.com',
      createdAt: '2026-06-29T00:00:00.000Z',
    });
    // No password hash / token leaked into the payload.
    expect(JSON.stringify(calls[0]!.payload)).not.toContain('password');
  });

  test('session.create.after fires auth.signin', async () => {
    const { dispatch, calls } = recorder();
    const hooks = buildAuthDatabaseHooks(PROJECT_ID, dispatch);

    await hooks.session!.create!.after!(
      { id: 's_1', userId: 'u_1', token: 'SECRET', createdAt: new Date() } as never,
      null,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.eventType).toBe('auth.signin');
    expect(calls[0]!.payload.sessionId).toBe('s_1');
    expect(calls[0]!.payload.userId).toBe('u_1');
    // The session token must never ride the webhook payload.
    expect(JSON.stringify(calls[0]!.payload)).not.toContain('SECRET');
  });

  test('session.delete.after fires auth.signout on a sign-out path', async () => {
    const { dispatch, calls } = recorder();
    const hooks = buildAuthDatabaseHooks(PROJECT_ID, dispatch);

    await hooks.session!.delete!.after!(
      { id: 's_1', userId: 'u_1' } as never,
      { path: '/sign-out' } as never,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.eventType).toBe('auth.signout');
  });

  test('session.delete.after fires auth.session.revoked on a revoke path', async () => {
    const { dispatch, calls } = recorder();
    const hooks = buildAuthDatabaseHooks(PROJECT_ID, dispatch);

    await hooks.session!.delete!.after!(
      { id: 's_1', userId: 'u_1' } as never,
      { path: '/revoke-session' } as never,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.eventType).toBe('auth.session.revoked');
  });

  test('a missing context falls back to auth.signout', async () => {
    const { dispatch, calls } = recorder();
    const hooks = buildAuthDatabaseHooks(PROJECT_ID, dispatch);

    await hooks.session!.delete!.after!({ id: 's_1', userId: 'u_1' } as never, null);

    expect(calls[0]!.eventType).toBe('auth.signout');
  });
});

describe('buildGenericOAuthConfigs — konnos + custom OIDC wiring', () => {
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

  test('wires konnos only when enabled + clientId + secret are all present', () => {
    const config = configWith({ konnos: { enabled: true, clientId: 'k-cid' } });
    const withSecret = buildGenericOAuthConfigs(config, { konnos: 'k-secret', oidc: {} });
    expect(withSecret.map((e) => e.providerId)).toEqual(['konnos']);

    const noSecret = buildGenericOAuthConfigs(config, { konnos: null, oidc: {} });
    expect(noSecret).toHaveLength(0);
  });

  test('wires a fully-configured issuer-based custom-OIDC provider via discoveryUrl', () => {
    const config: AuthConfig = { ...DEFAULT_AUTH_CONFIG, customOidc: [oidc()] };
    const entries = buildGenericOAuthConfigs(config, {
      konnos: null,
      oidc: { 'acme-sso': 'oidc-secret' },
    });
    expect(entries).toHaveLength(1);
    const e = entries[0]! as {
      providerId: string;
      clientId: string;
      clientSecret?: string;
      scopes?: string[];
      pkce?: boolean;
      issuer?: string;
      discoveryUrl?: string;
    };
    expect(e.providerId).toBe('acme-sso');
    expect(e.clientId).toBe('acme-public-client-id');
    expect(e.clientSecret).toBe('oidc-secret');
    expect(e.scopes).toEqual(['openid', 'profile', 'email']);
    expect(e.pkce).toBe(true);
    expect(e.discoveryUrl).toBe(
      'https://issuer.example.com/.well-known/openid-configuration',
    );
  });

  test('skips a custom-OIDC provider with no stored secret', () => {
    const config: AuthConfig = { ...DEFAULT_AUTH_CONFIG, customOidc: [oidc()] };
    const entries = buildGenericOAuthConfigs(config, {
      konnos: null,
      oidc: { 'acme-sso': null },
    });
    expect(entries).toHaveLength(0);
  });

  test('skips a disabled or endpoint-less custom-OIDC provider', () => {
    const config: AuthConfig = {
      ...DEFAULT_AUTH_CONFIG,
      customOidc: [
        oidc({ id: 'disabled', enabled: false }),
        oidc({ id: 'no-endpoints', issuer: null }),
      ],
    };
    const entries = buildGenericOAuthConfigs(config, {
      konnos: null,
      oidc: { disabled: 'x', 'no-endpoints': 'y' },
    });
    expect(entries).toHaveLength(0);
  });

  test('wires a custom-OIDC provider configured with explicit endpoints (no issuer)', () => {
    const config: AuthConfig = {
      ...DEFAULT_AUTH_CONFIG,
      customOidc: [
        oidc({
          id: 'explicit',
          issuer: null,
          authorizationUrl: 'https://i.example.com/authorize',
          tokenUrl: 'https://i.example.com/token',
          userinfoUrl: 'https://i.example.com/userinfo',
        }),
      ],
    };
    const entries = buildGenericOAuthConfigs(config, {
      konnos: null,
      oidc: { explicit: 'sec' },
    });
    expect(entries).toHaveLength(1);
    const e = entries[0]! as {
      providerId: string;
      authorizationUrl?: string;
      tokenUrl?: string;
      userInfoUrl?: string;
      discoveryUrl?: string;
    };
    expect(e.providerId).toBe('explicit');
    expect(e.authorizationUrl).toBe('https://i.example.com/authorize');
    expect(e.tokenUrl).toBe('https://i.example.com/token');
    expect(e.userInfoUrl).toBe('https://i.example.com/userinfo');
    expect(e.discoveryUrl).toBeUndefined();
  });

  test('combines konnos and custom OIDC in one config array', () => {
    const config: AuthConfig = {
      ...DEFAULT_AUTH_CONFIG,
      providers: {
        ...DEFAULT_AUTH_CONFIG.providers,
        konnos: { enabled: true, clientId: 'k-cid' },
      },
      customOidc: [oidc()],
    };
    const entries = buildGenericOAuthConfigs(config, {
      konnos: 'k-secret',
      oidc: { 'acme-sso': 'oidc-secret' },
    });
    expect(entries.map((e) => e.providerId)).toEqual(['konnos', 'acme-sso']);
  });
});

describe('resetPasswordUrl — hosted new-password contract', () => {
  test('builds <authBaseUrl>/auth/<projectId>/new-password?token=<token>', () => {
    const url = resetPasswordUrl(PROJECT_ID, 'tok123');
    expect(url).toBe(`${hostedAuthBaseUrl(PROJECT_ID)}/auth/${PROJECT_ID}/new-password?token=tok123`);
    expect(url).toContain('/auth/p_test123/new-password?token=');
  });

  test('url-encodes tokens with reserved characters', () => {
    const url = resetPasswordUrl(PROJECT_ID, 'a/b+c=d');
    expect(url).toContain('token=a%2Fb%2Bc%3Dd');
  });
});
