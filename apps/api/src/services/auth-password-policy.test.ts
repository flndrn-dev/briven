import { describe, expect, test } from 'bun:test';

import { ValidationError } from '@briven/shared';

import {
  DEFAULT_PASSWORD_POLICY,
  passwordHistoryDigest,
  validatePassword,
} from './auth-password-policy.js';

describe('validatePassword', () => {
  test('accepts default min length 8', () => {
    expect(() => validatePassword('abcdefgh', DEFAULT_PASSWORD_POLICY)).not.toThrow();
  });

  test('rejects short passwords', () => {
    expect(() => validatePassword('short', DEFAULT_PASSWORD_POLICY)).toThrow(ValidationError);
  });

  test('requires uppercase when configured', () => {
    const policy = { ...DEFAULT_PASSWORD_POLICY, requireUppercase: true };
    expect(() => validatePassword('abcdefgh', policy)).toThrow(/uppercase/i);
    expect(() => validatePassword('Abcdefgh', policy)).not.toThrow();
  });

  test('requires number + special when configured', () => {
    const policy = {
      ...DEFAULT_PASSWORD_POLICY,
      requireNumber: true,
      requireSpecial: true,
    };
    expect(() => validatePassword('Abcdefgh', policy)).toThrow(/number/i);
    expect(() => validatePassword('Abcdefg1', policy)).toThrow(/special/i);
    expect(() => validatePassword('Abcdefg1!', policy)).not.toThrow();
  });
});

describe('passwordHistoryDigest', () => {
  test('is stable and different for different passwords', () => {
    expect(passwordHistoryDigest('same')).toBe(passwordHistoryDigest('same'));
    expect(passwordHistoryDigest('a')).not.toBe(passwordHistoryDigest('b'));
  });
});
