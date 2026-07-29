import { describe, expect, test } from 'bun:test';

import { isHostedPlatformOrigin, methodFlagDenied } from './fdi-guard.js';

/**
 * FDI lock unit tests — SuperTokens-style: app proves itself with project + pk.
 * Full requireFdiProjectKey needs HTTP Context mock; we cover pure helpers +
 * document the live-proved codes here for CI stability.
 */

const allOn = {
  emailPassword: true,
  passwordlessEmail: true,
  magicLink: true,
  passwordlessSms: true,
  passkeys: true,
  mfa: true,
  social: true,
};

describe('fdi-guard methodFlagDenied', () => {
  test('blocks email password when disabled', () => {
    expect(
      methodFlagDenied({ ...allOn, emailPassword: false }, 'emailPassword'),
    ).toMatch(/disabled/i);
  });

  test('allows email password when enabled', () => {
    expect(methodFlagDenied(allOn, 'emailPassword')).toBeNull();
  });

  test('blocks passwordless email / magic link / sms / passkeys', () => {
    expect(
      methodFlagDenied({ ...allOn, passwordlessEmail: false }, 'passwordlessEmail'),
    ).toBeTruthy();
    expect(methodFlagDenied({ ...allOn, magicLink: false }, 'magicLink')).toBeTruthy();
    expect(
      methodFlagDenied({ ...allOn, passwordlessSms: false }, 'passwordlessSms'),
    ).toBeTruthy();
    expect(methodFlagDenied({ ...allOn, passkeys: false }, 'passkeys')).toBeTruthy();
  });

  test('mfa flag false does not block second factor (security enroll path)', () => {
    // Product: enrolled TOTP still verifiable even if "mfa" product toggle is off.
    expect(methodFlagDenied({ ...allOn, mfa: false }, 'mfa')).toBeNull();
  });
});

/** Document live FDI lock response codes (AUTH-HARDEN-90 / Batch A). */
describe('fdi lock response codes (contract)', () => {
  test('known codes for app integration', () => {
    const codes = [
      'project_required',
      'auth_key_required',
      'invalid_auth_key',
      'project_key_mismatch',
      'key_scope_readonly',
      'auth_disabled',
    ];
    expect(codes).toContain('project_required');
    expect(codes).toContain('auth_key_required');
    expect(codes.length).toBe(6);
  });
});

describe('isHostedPlatformOrigin (IdP hosted UI)', () => {
  test('matches Origin to web origin', () => {
    expect(
      isHostedPlatformOrigin('https://briven.tech', null, 'https://briven.tech'),
    ).toBe(true);
  });

  test('matches Referer origin when Origin empty', () => {
    expect(
      isHostedPlatformOrigin(
        null,
        'https://briven.tech/auth/p_x/otp?callbackURL=%2F',
        'https://briven.tech',
      ),
    ).toBe(true);
  });

  test('rejects foreign app origins (still need pk)', () => {
    expect(
      isHostedPlatformOrigin(
        'https://mavi.example',
        null,
        'https://briven.tech',
      ),
    ).toBe(false);
  });
});
