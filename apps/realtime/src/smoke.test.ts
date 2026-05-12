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
});
