import { describe, expect, test } from 'bun:test';

import { auditIpHashHint } from './audit.js';

describe('briven-engine audit (privacy)', () => {
  test('ip hint is 8 hex chars, never the raw IP', () => {
    const hint = auditIpHashHint('203.0.113.42');
    expect(hint).toMatch(/^[0-9a-f]{8}$/);
    expect(hint).not.toContain('203');
    expect(hint).not.toContain('113');
  });

  test('same IP always same hint', () => {
    expect(auditIpHashHint('198.51.100.7')).toBe(auditIpHashHint('198.51.100.7'));
  });

  test('different IPs get different hints', () => {
    expect(auditIpHashHint('198.51.100.7')).not.toBe(auditIpHashHint('198.51.100.8'));
  });

  test('empty / null IP → null hint', () => {
    expect(auditIpHashHint(null)).toBeNull();
    expect(auditIpHashHint(undefined)).toBeNull();
    expect(auditIpHashHint('')).toBeNull();
  });
});
