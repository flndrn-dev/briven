import { describe, expect, test } from 'bun:test';

import { DEFAULT_AUTH_CONFIG, type AuthConfig } from './tenant-config-store.js';
import {
  flagsFromConfig,
  hasAtLeastOneProvider,
  normalizeTwoFactorFlags,
  twoFactorFromConfig,
  type AuthV2ProviderFlags,
} from './auth-v2-workspace.js';

describe('auth-v2-workspace — provider proof helpers', () => {
  test('flagsFromConfig maps DEFAULT starter pack (all core ON)', () => {
    const flags = flagsFromConfig(DEFAULT_AUTH_CONFIG);
    expect(flags).toEqual({
      emailPassword: true,
      magicLink: true,
      emailOtp: true,
      passkey: true,
    });
    expect(hasAtLeastOneProvider(flags)).toBe(true);
  });

  test('flagsFromConfig reflects partial OFF (save-sticks shape)', () => {
    const config = {
      ...DEFAULT_AUTH_CONFIG,
      providers: {
        ...DEFAULT_AUTH_CONFIG.providers,
        magicLink: { enabled: false, expiryMinutes: 15 },
        emailOtp: { enabled: false, codeLength: 6, expiryMinutes: 5 },
        passkey: { enabled: true },
        emailPassword: { enabled: true },
      },
    } as AuthConfig;

    const flags = flagsFromConfig(config);
    expect(flags.magicLink).toBe(false);
    expect(flags.emailOtp).toBe(false);
    expect(flags.passkey).toBe(true);
    expect(flags.emailPassword).toBe(true);
    expect(hasAtLeastOneProvider(flags)).toBe(true);
  });

  test('hasAtLeastOneProvider rejects all-off (dashboard 400 rule)', () => {
    const allOff: AuthV2ProviderFlags = {
      emailPassword: false,
      magicLink: false,
      emailOtp: false,
      passkey: false,
    };
    expect(hasAtLeastOneProvider(allOff)).toBe(false);
  });
});

describe('auth-v2-workspace — Phase 8.1 two-factor / backup codes', () => {
  test('default config has 2FA off and zero backup codes', () => {
    const tf = twoFactorFromConfig(DEFAULT_AUTH_CONFIG);
    expect(tf.enabled).toBe(false);
    expect(tf.required).toBe(false);
    expect(tf.backupCodeCount).toBe(0);
  });

  test('when 2FA is on, backupCodeCount is 10 (Better Auth amount)', () => {
    const config = {
      ...DEFAULT_AUTH_CONFIG,
      twoFactor: { enabled: true, issuer: 'Acme', required: false },
    } as AuthConfig;
    const tf = twoFactorFromConfig(config);
    expect(tf.enabled).toBe(true);
    expect(tf.backupCodeCount).toBe(10);
  });

  test('normalizeTwoFactorFlags clears required when 2FA is off', () => {
    const tf = normalizeTwoFactorFlags({ enabled: false, required: true });
    expect(tf.enabled).toBe(false);
    expect(tf.required).toBe(false);
    expect(tf.backupCodeCount).toBe(0);
  });

  test('normalizeTwoFactorFlags keeps required only when enabled', () => {
    const tf = normalizeTwoFactorFlags({ enabled: true, required: true });
    expect(tf.enabled).toBe(true);
    expect(tf.required).toBe(true);
    expect(tf.backupCodeCount).toBe(10);
  });
});
