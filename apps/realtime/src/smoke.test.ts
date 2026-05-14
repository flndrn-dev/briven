import { describe, expect, it } from 'bun:test';

describe('realtime smoke', () => {
  it('env module loads with defaults', async () => {
    const { env } = await import('./env.js');
    expect(env.BRIVEN_ENV).toMatch(/^(development|staging|production)$/);
    expect(env.BRIVEN_REALTIME_PORT).toBeGreaterThan(0);
  });

  it('subscription caps have sane defaults', async () => {
    const { env } = await import('./env.js');
    // Per-WS cap: high enough that a normal app doesn't hit it (dozens
    // of useQuery hooks), low enough that a runaway loop is bounded
    // before memory pressure shows up.
    expect(env.BRIVEN_REALTIME_MAX_SUBS_PER_WS).toBeGreaterThanOrEqual(50);
    expect(env.BRIVEN_REALTIME_MAX_SUBS_PER_WS).toBeLessThanOrEqual(1000);
    // Per-project cap: aligned with the year-one 10k concurrent target
    // so a misconfig doesn't accidentally clamp Team customers below
    // their tier ceiling.
    expect(env.BRIVEN_REALTIME_MAX_SUBS_PER_PROJECT).toBeGreaterThanOrEqual(
      env.BRIVEN_REALTIME_MAX_SUBS_PER_WS,
    );
  });

  it('per-project hard cap configuration is consistent', async () => {
    const { env } = await import('./env.js');
    // Invariant 1: env ceiling must be at least the per-ws cap, else a
    // single legitimate client could exceed the project cap with one
    // socket — that would invalidate the tier-aware enforcement
    // (index.ts message handler reads tierCap ?? env-ceiling).
    expect(env.BRIVEN_REALTIME_MAX_SUBS_PER_PROJECT).toBeGreaterThanOrEqual(
      env.BRIVEN_REALTIME_MAX_SUBS_PER_WS,
    );
    // Invariant 2: env ceiling is the FLOOR for paid tiers. A metadata
    // outage falls back to this number; it must never sit below the
    // lowest tier's concurrentSubscriptions (free=100).
    expect(env.BRIVEN_REALTIME_MAX_SUBS_PER_PROJECT).toBeGreaterThanOrEqual(100);
  });
});
