/**
 * Pins the only pure decision in the Mavi Pay seam: paid subscribers =
 * pro + team (free never counts). The DB grouping is exercised by the
 * boot + the admin overview smoke; this covers the rule in isolation so
 * a change to the paid-tier definition shows up as a red test.
 */
import { describe, expect, test } from 'bun:test';

import { paidSubscribers, type PlanMix } from './mavi-pay.js';

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
