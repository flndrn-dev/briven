import { describe, expect, test } from 'bun:test';

import { RATE_LIMITS_BY_TIER, RATE_LIMIT_WINDOW_MS, TIERS } from './tiers.js';

describe('RATE_LIMITS_BY_TIER', () => {
  test('every scope has a positive limit for every tier', () => {
    for (const [scope, byTier] of Object.entries(RATE_LIMITS_BY_TIER)) {
      for (const [tier, limit] of Object.entries(byTier)) {
        expect(limit).toBeGreaterThan(0);
        expect(Number.isInteger(limit)).toBe(true);
        // Surface helpful context if the assertion fails.
        if (!Number.isInteger(limit) || limit <= 0) {
          throw new Error(`bad limit for ${scope}/${tier}: ${limit}`);
        }
      }
    }
  });

  test('limits are monotonically non-decreasing free → pro → team', () => {
    for (const byTier of Object.values(RATE_LIMITS_BY_TIER)) {
      expect(byTier.free).toBeLessThanOrEqual(byTier.pro);
      expect(byTier.pro).toBeLessThanOrEqual(byTier.team);
    }
  });

  test('covers invoke + deploy + mutate scopes', () => {
    expect(Object.keys(RATE_LIMITS_BY_TIER).sort()).toEqual(['deploy', 'invoke', 'mutate']);
  });

  test('window is exactly one minute', () => {
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
  });
});

describe('TIERS structural caps', () => {
  test('every tier has positive caps', () => {
    for (const limits of Object.values(TIERS)) {
      expect(limits.projectsPerOrg).toBeGreaterThan(0);
      expect(limits.functionsPerProject).toBeGreaterThan(0);
      expect(limits.invokesPerMonth).toBeGreaterThan(0);
    }
  });

  test('structural caps are monotonically non-decreasing', () => {
    expect(TIERS.free.projectsPerOrg).toBeLessThanOrEqual(TIERS.pro.projectsPerOrg);
    expect(TIERS.pro.projectsPerOrg).toBeLessThanOrEqual(TIERS.team.projectsPerOrg);
    expect(TIERS.free.functionsPerProject).toBeLessThanOrEqual(TIERS.pro.functionsPerProject);
    expect(TIERS.pro.functionsPerProject).toBeLessThanOrEqual(TIERS.team.functionsPerProject);
    expect(TIERS.free.invokesPerMonth).toBeLessThanOrEqual(TIERS.pro.invokesPerMonth);
    expect(TIERS.pro.invokesPerMonth).toBeLessThanOrEqual(TIERS.team.invokesPerMonth);
  });
});
