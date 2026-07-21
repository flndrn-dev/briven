import { describe, expect, test } from 'bun:test';

import { DEFAULT_AUTH_CONFIG, type AuthConfig } from './tenant-config-store.js';
import {
  flagsFromConfig,
  hasAtLeastOneProvider,
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
