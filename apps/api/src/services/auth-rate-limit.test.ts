import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

/**
 * S6.2 — rate-limit reliability (memory backend).
 * Forces the in-memory path by clearing BRIVEN_REDIS_URL so we can assert
 * deny-after-N and per-project isolation without a live Redis.
 */

const ORIGINAL_REDIS = process.env.BRIVEN_REDIS_URL;

beforeEach(() => {
  delete process.env.BRIVEN_REDIS_URL;
});

afterEach(() => {
  if (ORIGINAL_REDIS === undefined) delete process.env.BRIVEN_REDIS_URL;
  else process.env.BRIVEN_REDIS_URL = ORIGINAL_REDIS;
});

describe('auth rate limit — memory backend (S6.2)', () => {
  test('allows under maxAttempts then denies', async () => {
    // Dynamic import after env tweak so getRedis() sees no URL.
    const { checkIpRateLimit } = await import('./auth-rate-limit.js');
    const { resetAuthReliabilityCountersForTests } = await import('./auth-reliability.js');
    resetAuthReliabilityCountersForTests();

    const projectId = `p_rl_${Date.now()}`;
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const opts = { maxAttempts: 3, windowMinutes: 5 };

    const a1 = await checkIpRateLimit(projectId, ip, opts);
    const a2 = await checkIpRateLimit(projectId, ip, opts);
    const a3 = await checkIpRateLimit(projectId, ip, opts);
    const a4 = await checkIpRateLimit(projectId, ip, opts);

    expect(a1.allowed).toBe(true);
    expect(a2.allowed).toBe(true);
    expect(a3.allowed).toBe(true);
    expect(a4.allowed).toBe(false);
    expect(a4.retryAfterSeconds).toBeGreaterThan(0);
  });

  test('buckets are isolated per projectId (cross-project cannot share limit)', async () => {
    const { checkIpRateLimit } = await import('./auth-rate-limit.js');
    const opts = { maxAttempts: 2, windowMinutes: 5 };
    const ip = '198.51.100.50';
    const a = `p_iso_a_${Date.now()}`;
    const b = `p_iso_b_${Date.now()}`;

    expect((await checkIpRateLimit(a, ip, opts)).allowed).toBe(true);
    expect((await checkIpRateLimit(a, ip, opts)).allowed).toBe(true);
    expect((await checkIpRateLimit(a, ip, opts)).allowed).toBe(false);

    // Project B still has a full budget for the same IP.
    expect((await checkIpRateLimit(b, ip, opts)).allowed).toBe(true);
  });
});
