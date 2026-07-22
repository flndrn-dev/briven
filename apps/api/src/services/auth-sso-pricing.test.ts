import { describe, expect, test } from 'bun:test';

import { currentUtcHourStart } from './auth-sso-pricing.js';

describe('auth-sso-pricing helpers', () => {
  test('currentUtcHourStart floors to the hour in UTC', () => {
    const d = new Date('2026-07-22T15:47:33.123Z');
    const hour = currentUtcHourStart(d);
    expect(hour.toISOString()).toBe('2026-07-22T15:00:00.000Z');
  });

  test('same hour for any minute within the hour', () => {
    const a = currentUtcHourStart(new Date('2026-01-01T00:00:00.000Z'));
    const b = currentUtcHourStart(new Date('2026-01-01T00:59:59.999Z'));
    expect(a.getTime()).toBe(b.getTime());
  });
});
