import { describe, expect, test } from 'bun:test';

import {
  hashSecret,
  matchPasswordlessSecret,
  sixDigitCode,
} from './passwordless.js';

describe('passwordless pure helpers (Phase 3)', () => {
  test('sixDigitCode is 6 digits', () => {
    for (let i = 0; i < 20; i++) {
      const c = sixDigitCode();
      expect(c).toMatch(/^\d{6}$/);
      expect(Number(c)).toBeGreaterThanOrEqual(100000);
      expect(Number(c)).toBeLessThanOrEqual(999999);
    }
  });

  test('match OTP-only hash', () => {
    const otp = '123456';
    const stored = hashSecret(otp);
    expect(matchPasswordlessSecret(stored, { userInputCode: otp })).toBe(true);
    expect(matchPasswordlessSecret(stored, { userInputCode: '000000' })).toBe(
      false,
    );
  });

  test('match link-only hash', () => {
    const link = 'abcLinkCodeXYZ';
    const stored = hashSecret(link);
    expect(matchPasswordlessSecret(stored, { linkCode: link })).toBe(true);
    expect(matchPasswordlessSecret(stored, { linkCode: 'nope' })).toBe(false);
  });

  test('match dual otp:link form', () => {
    const otp = '654321';
    const link = 'linkSecret99';
    const stored = `${hashSecret(otp)}:${hashSecret(link)}`;
    expect(matchPasswordlessSecret(stored, { userInputCode: otp })).toBe(true);
    expect(matchPasswordlessSecret(stored, { linkCode: link })).toBe(true);
    expect(
      matchPasswordlessSecret(stored, { userInputCode: '111111', linkCode: 'x' }),
    ).toBe(false);
  });

  test('empty input fails', () => {
    expect(matchPasswordlessSecret(hashSecret('1'), {})).toBe(false);
  });
});
