import { describe, expect, test } from 'bun:test';

import { creditPercentForBreach, previousMonthBounds, SLA_TIERS } from './sla.js';

describe('SLA_TIERS', () => {
  test('free tier has no SLA — no auto-credit ever fires', () => {
    expect(SLA_TIERS.free).toBeNull();
  });

  test('pro tier targets 99.5% uptime', () => {
    expect(SLA_TIERS.pro?.targetUptime).toBe(0.995);
  });

  test('team tier targets 99.9% uptime — more than 2x stricter than pro', () => {
    expect(SLA_TIERS.team?.targetUptime).toBe(0.999);
    const proDowntime = 1 - SLA_TIERS.pro!.targetUptime;
    const teamDowntime = 1 - SLA_TIERS.team!.targetUptime;
    expect(proDowntime / teamDowntime).toBeCloseTo(5, 0); // pro allows 5x the downtime
  });

  test('downtime budgets are sane for a 30-day month', () => {
    const monthSeconds = 30 * 86400;
    // Pro: 0.5% of a month ≈ 3h 36m
    expect(SLA_TIERS.pro!.maxMonthlyDowntimeSeconds).toBeGreaterThan(12_000);
    expect(SLA_TIERS.pro!.maxMonthlyDowntimeSeconds).toBeLessThan(monthSeconds * 0.01);
    // Team: 0.1% of a month ≈ 43m
    expect(SLA_TIERS.team!.maxMonthlyDowntimeSeconds).toBeGreaterThan(2_000);
    expect(SLA_TIERS.team!.maxMonthlyDowntimeSeconds).toBeLessThan(3_000);
  });
});

describe('creditPercentForBreach', () => {
  test('no breach → no credit', () => {
    expect(creditPercentForBreach(0.995, 0.999)).toBe(0);
    expect(creditPercentForBreach(0.995, 0.995)).toBe(0);
  });

  test('small breach (< 0.5% over the threshold) → 10% credit', () => {
    expect(creditPercentForBreach(0.995, 0.993)).toBe(0.1);
    expect(creditPercentForBreach(0.995, 0.991)).toBe(0.1);
  });

  test('moderate breach (0.5%–1%) → 25% credit', () => {
    expect(creditPercentForBreach(0.995, 0.989)).toBe(0.25);
    expect(creditPercentForBreach(0.995, 0.986)).toBe(0.25);
  });

  test('substantial breach (1%–5%) → 50% credit', () => {
    expect(creditPercentForBreach(0.995, 0.98)).toBe(0.5);
    expect(creditPercentForBreach(0.995, 0.95)).toBe(0.5);
  });

  test('major outage (> 5% breach) → 100% credit (full month free)', () => {
    expect(creditPercentForBreach(0.995, 0.94)).toBe(1);
    expect(creditPercentForBreach(0.999, 0.85)).toBe(1);
  });
});

describe('previousMonthBounds', () => {
  test('mid-month March → all of February', () => {
    const now = new Date('2026-03-15T10:00:00Z');
    const { start, end } = previousMonthBounds(now);
    expect(start.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  test('first of January → all of December last year', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const { start, end } = previousMonthBounds(now);
    expect(start.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
