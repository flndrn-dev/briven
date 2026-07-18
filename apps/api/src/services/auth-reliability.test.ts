import { describe, expect, test } from 'bun:test';

import {
  getAuthReliabilitySnapshot,
  recordAuthMailerFailure,
  recordAuthRateLimitDenied,
  recordAuthRoute5xx,
  resetAuthReliabilityCountersForTests,
} from './auth-reliability.js';

describe('auth-reliability snapshot (S6.3)', () => {
  test('records counters and returns operator watch list', async () => {
    resetAuthReliabilityCountersForTests();
    recordAuthRateLimitDenied('memory');
    recordAuthMailerFailure('briven_auth_magic_link');
    recordAuthRoute5xx();

    const snap = await getAuthReliabilitySnapshot();
    expect(snap.counters.rateLimitDenied).toBeGreaterThanOrEqual(1);
    expect(snap.counters.mailerFailures).toBeGreaterThanOrEqual(1);
    expect(snap.counters.authRoute5xx).toBeGreaterThanOrEqual(1);
    expect(snap.watch.length).toBeGreaterThan(0);
    expect(snap.isolation.claim.toLowerCase()).toContain('project');
    expect(typeof snap.redisConfigured).toBe('boolean');
  });
});
