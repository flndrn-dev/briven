import { describe, expect, test } from 'bun:test';

import { ORG_LIMIT_BY_TIER, slugFromEmail } from './orgs.js';

describe('ORG_LIMIT_BY_TIER', () => {
  test('free caps at 1 (personal only, no team creation)', () => {
    expect(ORG_LIMIT_BY_TIER.free).toBe(1);
  });

  test('pro is unlimited — paying users can create as many teams as they need', () => {
    // Industry norm: Vercel, GitHub, Netlify all allow unlimited teams
    // on paid tiers. Convex doesn't surface a team count at all (their
    // pricing is per-developer-seat). Briven matches this convention
    // so a Pro subscriber can have multiple separate team workspaces.
    expect(ORG_LIMIT_BY_TIER.pro).toBe(Infinity);
  });

  test('team is unlimited', () => {
    expect(ORG_LIMIT_BY_TIER.team).toBe(Infinity);
  });

  test('caps are monotonically non-decreasing free → pro → team', () => {
    expect(ORG_LIMIT_BY_TIER.free).toBeLessThanOrEqual(ORG_LIMIT_BY_TIER.pro);
    expect(ORG_LIMIT_BY_TIER.pro).toBeLessThanOrEqual(ORG_LIMIT_BY_TIER.team);
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
