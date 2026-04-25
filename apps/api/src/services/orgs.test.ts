import { describe, expect, test } from 'bun:test';

import { ORG_LIMIT_BY_TIER, slugFromEmail } from './orgs.js';

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

describe('slugFromEmail', () => {
  test('lowercases and keeps alphanumeric local-part', () => {
    expect(slugFromEmail('Alice@example.com')).toBe('alice');
  });

  test('replaces dots and plus tags with single dashes', () => {
    expect(slugFromEmail('alice.smith+work@example.com')).toBe('alice-smith-work');
  });

  test('strips edge dashes that come from leading/trailing punctuation', () => {
    expect(slugFromEmail('-alice-@example.com')).toBe('alice');
  });

  test('returns empty string for empty local-part', () => {
    expect(slugFromEmail('@example.com')).toBe('');
  });

  test('returns empty string for an entirely non-alnum local-part', () => {
    expect(slugFromEmail('...@example.com')).toBe('');
  });

  test('handles missing @ gracefully (whole input treated as local-part)', () => {
    expect(slugFromEmail('plainstring')).toBe('plainstring');
  });
});
