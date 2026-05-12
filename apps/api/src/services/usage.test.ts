import { describe, expect, test } from 'bun:test';

import { TIERS } from './tiers.js';
import { currentMonthBounds } from './usage.js';

describe('currentMonthBounds', () => {
  test('first day of January gives Jan 1 → Feb 1 in UTC', () => {
    const now = new Date('2026-01-01T05:30:00.000Z');
    const { periodStart, periodEnd } = currentMonthBounds(now);
    expect(periodStart.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  test('mid-month date gives the same bounds as start-of-month', () => {
    const now = new Date('2026-05-09T18:42:11.000Z');
    const { periodStart, periodEnd } = currentMonthBounds(now);
    expect(periodStart.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  test('last second of December rolls into January next year', () => {
    const now = new Date('2026-12-31T23:59:59.999Z');
    const { periodStart, periodEnd } = currentMonthBounds(now);
    expect(periodStart.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  test('first millisecond of a month is in that month, not the prior one', () => {
    const now = new Date('2026-07-01T00:00:00.000Z');
    const { periodStart, periodEnd } = currentMonthBounds(now);
    expect(periodStart.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  test('handles February in non-leap year (28 days)', () => {
    const now = new Date('2026-02-15T12:00:00.000Z');
    const { periodStart, periodEnd } = currentMonthBounds(now);
    expect(periodStart.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  test('handles February in leap year (29 days, end is still Mar 1)', () => {
    const now = new Date('2028-02-29T12:00:00.000Z');
    const { periodStart, periodEnd } = currentMonthBounds(now);
    expect(periodStart.toISOString()).toBe('2028-02-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2028-03-01T00:00:00.000Z');
  });

  test('non-UTC inputs still produce UTC bounds', () => {
    // 2026-05-31T23:00:00 in a +02:00 zone is 2026-05-31T21:00:00 UTC,
    // so the month is still May.
    const now = new Date('2026-05-31T23:00:00.000+02:00');
    const { periodStart } = currentMonthBounds(now);
    expect(periodStart.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });
});

describe('TIERS.storageBytes', () => {
  // The storage caps are surfaced as both a hard ceiling for future
  // deploy-time enforcement and a soft cap rendered on the dashboard
  // usage widget. The ordering invariant matters — a paid tier must
  // never offer less storage than a free one.
  test('storage caps are strictly increasing free < pro < team', () => {
    expect(TIERS.free.storageBytes).toBeLessThan(TIERS.pro.storageBytes);
    expect(TIERS.pro.storageBytes).toBeLessThan(TIERS.team.storageBytes);
  });

  test('free tier ships at exactly 1 GiB', () => {
    expect(TIERS.free.storageBytes).toBe(1024 * 1024 * 1024);
  });

  test('pro tier ships at exactly 10 GiB', () => {
    expect(TIERS.pro.storageBytes).toBe(10 * 1024 * 1024 * 1024);
  });

  test('team tier ships at exactly 100 GiB', () => {
    expect(TIERS.team.storageBytes).toBe(100 * 1024 * 1024 * 1024);
  });
});
