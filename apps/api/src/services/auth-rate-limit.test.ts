/**
 * Memory-backed rate limit burst proof (Sprint S4).
 * Does not require Redis — proves the algorithm that Redis path mirrors.
 */
import { afterEach, describe, expect, test } from 'bun:test';

import { checkIpRateLimit, resetRateLimit } from './auth-rate-limit.js';

const PROJECT = 'p_rate_test';
const IP = '203.0.113.50';

afterEach(async () => {
  await resetRateLimit('ip', PROJECT, IP);
});

describe('checkIpRateLimit — memory burst', () => {
  test('allows up to maxAttempts then denies with retryAfter', async () => {
    const opts = { maxAttempts: 3, windowMinutes: 15 };
    const r1 = await checkIpRateLimit(PROJECT, IP, opts);
    const r2 = await checkIpRateLimit(PROJECT, IP, opts);
    const r3 = await checkIpRateLimit(PROJECT, IP, opts);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    const blocked = await checkIpRateLimit(PROJECT, IP, opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  test('reset clears the bucket', async () => {
    const opts = { maxAttempts: 1, windowMinutes: 15 };
    expect((await checkIpRateLimit(PROJECT, IP, opts)).allowed).toBe(true);
    expect((await checkIpRateLimit(PROJECT, IP, opts)).allowed).toBe(false);
    await resetRateLimit('ip', PROJECT, IP);
    expect((await checkIpRateLimit(PROJECT, IP, opts)).allowed).toBe(true);
  });
});
