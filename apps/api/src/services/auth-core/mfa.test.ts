import { describe, expect, test } from 'bun:test';

import { generateTotpCode, verifyTotpCode } from './mfa.js';

describe('TOTP pure helpers (Phase 5)', () => {
  // Fixed secret for deterministic tests (base32 of known bytes)
  const secret = 'JBSWY3DPEHPK3PXP';

  test('generates 6-digit codes', () => {
    const code = generateTotpCode(secret, 1_700_000_000_000);
    expect(code).toMatch(/^\d{6}$/);
  });

  test('verifies matching code', () => {
    const at = 1_700_000_000_000;
    const code = generateTotpCode(secret, at);
    expect(verifyTotpCode(secret, code, 1, at)).toBe(true);
  });

  test('rejects wrong code', () => {
    expect(verifyTotpCode(secret, '000000', 1, 1_700_000_000_000)).toBe(false);
  });

  test('accepts within time window', () => {
    const at = 1_700_000_000_000;
    const code = generateTotpCode(secret, at);
    // one step later still within window=1
    expect(verifyTotpCode(secret, code, 1, at + 30_000)).toBe(true);
  });
});
