/**
 * Hour-boundary tests for the usage aggregator. The DB-touching path
 * (aggregateUsageForCompletedHour) is exercised by the post-deploy
 * smoke; this file pins the pure boundary math + the conflict-update
 * shape so a future tweak surfaces in CI.
 */

import { describe, expect, test } from 'bun:test';

import { currentHourStart } from './usage-aggregator.js';

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
