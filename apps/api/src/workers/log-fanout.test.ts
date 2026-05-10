/**
 * Audit-log retention boundary tests — pin the 13-month window so a
 * tweak to the constant or the math surfaces in CI rather than as a
 * silent compliance drift (privacy policy §5).
 *
 * The DB-touching path (pruneOldAuditLogs) is exercised by the
 * post-deploy smoke; this file pins the pure cutoff calculation.
 */

import { describe, expect, test } from 'bun:test';

import { AUDIT_RETENTION_DAYS, auditRetentionCutoff } from './log-fanout.js';

describe('AUDIT_RETENTION_DAYS', () => {
  test('matches the policy commitment of 13 months (≈ 390 days)', () => {
    expect(AUDIT_RETENTION_DAYS).toBe(390);
  });
});

describe('auditRetentionCutoff', () => {
  // Fixed point so the deltas are easy to reason about.
  const NOW = new Date('2026-05-11T00:00:00Z').getTime();
  const ONE_DAY = 86_400_000;

  test('cutoff is exactly 13 months before now', () => {
    const cutoff = auditRetentionCutoff(NOW);
    const deltaDays = Math.round((NOW - cutoff.getTime()) / ONE_DAY);
    expect(deltaDays).toBe(AUDIT_RETENTION_DAYS);
  });

  test('cutoff rolls forward with now (no caching surprise)', () => {
    const cutoff1 = auditRetentionCutoff(NOW);
    const cutoff2 = auditRetentionCutoff(NOW + 7 * ONE_DAY);
    expect(cutoff2.getTime() - cutoff1.getTime()).toBe(7 * ONE_DAY);
  });

  test('a row 13 months + 1 day old is past cutoff', () => {
    const cutoff = auditRetentionCutoff(NOW);
    const rowAge = AUDIT_RETENTION_DAYS + 1;
    const rowCreatedAt = new Date(NOW - rowAge * ONE_DAY);
    expect(rowCreatedAt.getTime()).toBeLessThan(cutoff.getTime());
  });

  test('a row 12 months old is still inside the window', () => {
    const cutoff = auditRetentionCutoff(NOW);
    const rowCreatedAt = new Date(NOW - 360 * ONE_DAY);
    expect(rowCreatedAt.getTime()).toBeGreaterThan(cutoff.getTime());
  });
});
