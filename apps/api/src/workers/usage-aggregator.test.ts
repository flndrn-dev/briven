/**
 * Hour-boundary tests for the usage aggregator. The DB-touching path
 * (aggregateUsageForCompletedHour) is exercised by the post-deploy
 * smoke; this file pins the pure boundary math + the conflict-update
 * shape so a future tweak surfaces in CI.
 */

import { describe, expect, test } from 'bun:test';

import { isGaugeMetric } from '../db/schema.js';

import { currentHourStart, usagePeriodStart } from './usage-aggregator.js';

describe('currentHourStart', () => {
  test('snaps to the first millisecond of the containing UTC hour', () => {
    // 14:23:45.678 UTC → 14:00:00.000 UTC
    const mid = new Date('2026-05-11T14:23:45.678Z');
    const out = currentHourStart(mid);
    expect(out.toISOString()).toBe('2026-05-11T14:00:00.000Z');
  });

  test('the first millisecond of an hour stays on that hour', () => {
    // 14:00:00.000 UTC → 14:00:00.000 UTC (idempotent on a boundary)
    const exact = new Date('2026-05-11T14:00:00.000Z');
    expect(currentHourStart(exact).toISOString()).toBe('2026-05-11T14:00:00.000Z');
  });

  test('the last millisecond of an hour stays in that hour', () => {
    // 14:59:59.999 UTC → 14:00:00.000 UTC (not rolled forward)
    const last = new Date('2026-05-11T14:59:59.999Z');
    expect(currentHourStart(last).toISOString()).toBe('2026-05-11T14:00:00.000Z');
  });

  test('midnight UTC handles correctly', () => {
    const midnight = new Date('2026-05-11T00:00:00.000Z');
    expect(currentHourStart(midnight).toISOString()).toBe('2026-05-11T00:00:00.000Z');
  });

  test('crosses month boundary correctly', () => {
    // 23:59:59.999 on the last day of April → 23:00 same day
    const lastMin = new Date('2026-04-30T23:59:59.999Z');
    expect(currentHourStart(lastMin).toISOString()).toBe('2026-04-30T23:00:00.000Z');
  });
});

describe('completed-hour window', () => {
  // The aggregator rolls up the hour that JUST ENDED — [start, end)
  // where end == currentHourStart(now). This pins that the window is
  // exactly one hour and ends at a clean boundary.
  function completedHourWindow(now: Date): { start: Date; end: Date } {
    const end = currentHourStart(now);
    const start = new Date(end.getTime() - 60 * 60 * 1000);
    return { start, end };
  }

  test('rolls up the previous full hour', () => {
    const now = new Date('2026-05-11T14:05:00.000Z');
    const { start, end } = completedHourWindow(now);
    expect(start.toISOString()).toBe('2026-05-11T13:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-11T14:00:00.000Z');
  });

  test('window is exactly 60 minutes wide', () => {
    const now = new Date('2026-05-11T03:30:00.000Z');
    const { start, end } = completedHourWindow(now);
    expect(end.getTime() - start.getTime()).toBe(60 * 60 * 1000);
  });
});

describe('metric kind (gauge vs counter)', () => {
  test('storage_bytes and auth_mau are gauges', () => {
    expect(isGaugeMetric('storage_bytes')).toBe(true);
    expect(isGaugeMetric('auth_mau')).toBe(true);
  });
  test('invocations and connection_seconds are counters', () => {
    expect(isGaugeMetric('invocations')).toBe(false);
    expect(isGaugeMetric('connection_seconds')).toBe(false);
  });
});

describe('usagePeriodStart — the billing period a sample lands in', () => {
  // Two hours in the SAME month must map a gauge to the SAME month-start key,
  // which is what collapses ~720 hourly snapshots onto one row.
  const hourA = new Date('2026-05-02T03:00:00.000Z');
  const hourAEnd = new Date('2026-05-02T04:00:00.000Z');
  const hourB = new Date('2026-05-27T14:00:00.000Z');
  const hourBEnd = new Date('2026-05-27T15:00:00.000Z');
  const monthStart = new Date('2026-05-01T00:00:00.000Z');

  test('gauges collapse every in-month hour onto the UTC month-start', () => {
    expect(usagePeriodStart('auth_mau', hourA, hourAEnd).toISOString()).toBe(
      monthStart.toISOString(),
    );
    expect(usagePeriodStart('auth_mau', hourB, hourBEnd).toISOString()).toBe(
      monthStart.toISOString(),
    );
    expect(usagePeriodStart('storage_bytes', hourB, hourBEnd).toISOString()).toBe(
      monthStart.toISOString(),
    );
  });

  test('counters keep the hour as their period', () => {
    expect(usagePeriodStart('invocations', hourA, hourAEnd).toISOString()).toBe(
      hourA.toISOString(),
    );
    expect(usagePeriodStart('connection_seconds', hourB, hourBEnd).toISOString()).toBe(
      hourB.toISOString(),
    );
  });

  test('the month-boundary hour files the gauge under the NEW month (uses hourEnd)', () => {
    // [23:00 May 31, 00:00 Jun 1): the gauge snapshot taken ~now belongs to
    // June, so it must NOT clobber May's final value.
    const lastHour = new Date('2026-05-31T23:00:00.000Z');
    const lastHourEnd = new Date('2026-06-01T00:00:00.000Z');
    expect(usagePeriodStart('auth_mau', lastHour, lastHourEnd).toISOString()).toBe(
      '2026-06-01T00:00:00.000Z',
    );
  });
});
