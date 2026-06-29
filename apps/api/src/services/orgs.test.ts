import { describe, expect, test } from 'bun:test';

import { ORG_LIMIT_BY_TIER, isUniqueViolation, slugFromEmail } from './orgs.js';

describe('isUniqueViolation (account-deletion 500 regression)', () => {
  test('detects a top-level pg 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  test('detects a Drizzle-WRAPPED 23505 nested in err.cause — the actual bug', () => {
    // This is exactly the shape that 500'd /v1/me: the wrapper message has
    // no "duplicate key" text and no top-level code; the real code is in cause.
    const wrapped = Object.assign(
      new Error('Failed query: insert into "organizations" ...\nparams: org_x,slug,name,true,x'),
      { cause: { code: '23505', message: 'duplicate key value violates unique constraint' } },
    );
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  test('detects via message text alone', () => {
    expect(
      isUniqueViolation(
        new Error('duplicate key value violates unique constraint "organizations_pkey"'),
      ),
    ).toBe(true);
  });

  test('ignores unrelated errors', () => {
    expect(isUniqueViolation(new Error('connection refused'))).toBe(false);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

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
