/**
 * Pins the pure decisions in the Mavi Pay seam so a change to any rule shows up
 * as a red test:
 *   - paidSubscribers : paid = pro + team (free never counts).
 *   - buildPlanMix    : free from projects, pro/team from active subs.
 *   - computeMrr      : MRR = pro×proPrice + team×teamPrice.
 *   - churn window    : canceled AND updated within 30 days.
 * The DB grouping + the live Polar price fetch are exercised by the boot + the
 * admin overview smoke; these cover the math in isolation (no DB, no Polar).
 */
import { describe, expect, test } from 'bun:test';

import {
  buildPlanMix,
  computeMrr,
  countChurnWithinWindow,
  isChurnWithinWindow,
  paidSubscribers,
  type PlanMix,
} from './mavi-pay.js';

describe('paidSubscribers', () => {
  test('counts pro + team, never free', () => {
    const mix: PlanMix = { free: 10, pro: 3, team: 2 };
    expect(paidSubscribers(mix)).toBe(5);
  });

  test('is 0 when every project is on free', () => {
    const mix: PlanMix = { free: 7, pro: 0, team: 0 };
    expect(paidSubscribers(mix)).toBe(0);
  });

  test('is 0 on an empty platform', () => {
    const mix: PlanMix = { free: 0, pro: 0, team: 0 };
    expect(paidSubscribers(mix)).toBe(0);
  });
});

describe('buildPlanMix', () => {
  test('takes free from the project count and pro/team from active subs', () => {
    const mix = buildPlanMix(42, [
      { tier: 'pro', count: 5 },
      { tier: 'team', count: 2 },
    ]);
    expect(mix).toEqual({ free: 42, pro: 5, team: 2 });
  });

  test('seeds every tier at 0 when there are no subs', () => {
    expect(buildPlanMix(0, [])).toEqual({ free: 0, pro: 0, team: 0 });
  });

  test('ignores a stray free-tier sub row (free comes from projects)', () => {
    const mix = buildPlanMix(3, [
      { tier: 'free', count: 9 },
      { tier: 'pro', count: 1 },
    ]);
    expect(mix).toEqual({ free: 3, pro: 1, team: 0 });
  });
});

describe('computeMrr', () => {
  test('sums pro and team subs at their monthly prices', () => {
    // 5 pro @ €19 + 2 team @ €49 = 95 + 98 = 193
    expect(computeMrr({ pro: 5, team: 2 }, { pro: 19, team: 49 })).toBe(193);
  });

  test('is 0 with no paying subs', () => {
    expect(computeMrr({ pro: 0, team: 0 }, { pro: 19, team: 49 })).toBe(0);
  });

  test('handles fractional (cents-derived) prices', () => {
    // price_amount 1999c -> €19.99
    expect(computeMrr({ pro: 2, team: 0 }, { pro: 19.99, team: 49.99 })).toBeCloseTo(39.98, 2);
  });
});

describe('churn window', () => {
  const now = new Date('2026-06-27T00:00:00.000Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  test('counts a sub canceled 5 days ago', () => {
    expect(isChurnWithinWindow({ status: 'canceled', updatedAt: daysAgo(5) }, now)).toBe(true);
  });

  test('excludes a sub canceled 40 days ago (outside the 30d window)', () => {
    expect(isChurnWithinWindow({ status: 'canceled', updatedAt: daysAgo(40) }, now)).toBe(false);
  });

  test('excludes a non-canceled sub even if updated recently', () => {
    expect(isChurnWithinWindow({ status: 'active', updatedAt: daysAgo(1) }, now)).toBe(false);
    expect(isChurnWithinWindow({ status: 'past_due', updatedAt: daysAgo(1) }, now)).toBe(false);
  });

  test('counts only the in-window canceled subs across a mixed set', () => {
    const subs = [
      { status: 'canceled' as const, updatedAt: daysAgo(2) },
      { status: 'canceled' as const, updatedAt: daysAgo(29) },
      { status: 'canceled' as const, updatedAt: daysAgo(31) },
      { status: 'active' as const, updatedAt: daysAgo(1) },
    ];
    expect(countChurnWithinWindow(subs, now)).toBe(2);
  });
});
