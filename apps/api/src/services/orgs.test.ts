import { describe, expect, test } from 'bun:test';

import { ORG_LIMIT_BY_TIER } from './orgs.js';

describe('ORG_LIMIT_BY_TIER', () => {
  test('free caps at 1', () => {
    expect(ORG_LIMIT_BY_TIER.free).toBe(1);
  });

  test('pro caps at 3', () => {
    expect(ORG_LIMIT_BY_TIER.pro).toBe(3);
  });

  test('team is unlimited (Infinity)', () => {
    expect(ORG_LIMIT_BY_TIER.team).toBe(Infinity);
  });
});
