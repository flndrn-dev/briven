import { describe, expect, test } from 'bun:test';

import {
  consumeMfaChallenge,
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

  test('consume rejects wrong userId', async () => {
    const token = issueMfaChallenge({
      userId: 'beu_a',
      tenantId: 'tenant_x',
    });
    const r = await consumeMfaChallenge(token, 'beu_other');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/match user/i);
  });

  test('consume accepts matching user (Redis optional)', async () => {
    const token = issueMfaChallenge({
      userId: 'beu_consume',
      tenantId: 'tenant_x',
    });
    const r = await consumeMfaChallenge(token, 'beu_consume');
    expect(r.ok).toBe(true);
    // Second consume: with Redis NX → already used; without Redis → still ok (fail-open)
    const r2 = await consumeMfaChallenge(token, 'beu_consume');
    if (r2.ok) {
      // no redis — signature still valid within TTL
      expect(r2.userId).toBe('beu_consume');
    } else {
      expect(r2.message).toMatch(/already used|expired|invalid/i);
    }
  });
});
