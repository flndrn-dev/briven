import { describe, expect, test } from 'bun:test';

import {
  issueMfaChallenge,
  parseMfaChallenge,
} from './mfa-challenge.js';

describe('mfa-challenge', () => {
  test('issues and parses a valid challenge', () => {
    const token = issueMfaChallenge({
      userId: 'beu_test',
      tenantId: 'tenant_x',
    });
    const parsed = parseMfaChallenge(token);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.userId).toBe('beu_test');
      expect(parsed.tenantId).toBe('tenant_x');
      expect(parsed.nonce.length).toBeGreaterThan(8);
    }
  });

  test('rejects tampered challenge', () => {
    const token = issueMfaChallenge({
      userId: 'beu_test',
      tenantId: 'tenant_x',
    });
    const bad = token.slice(0, -4) + 'xxxx';
    const parsed = parseMfaChallenge(bad);
    expect(parsed.ok).toBe(false);
  });

  test('rejects empty challenge', () => {
    expect(parseMfaChallenge('').ok).toBe(false);
    expect(parseMfaChallenge(null).ok).toBe(false);
  });
});
