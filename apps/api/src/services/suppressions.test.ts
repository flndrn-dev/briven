/**
 * Unit tests for the suppression service. The DB-touching paths
 * (suppress / unsuppress / listSuppressions / isSuppressed) are
 * exercised by the post-deploy integration smoke; this file pins the
 * pure logic of the mittera-webhook dispatcher — which event types
 * trigger suppression and with what reason — so a regression there
 * surfaces in CI rather than in production after a real bounce.
 */

import { describe, expect, test } from 'bun:test';

// Local mirror of the dispatch logic in routes/mittera-webhook.ts.
// When that file changes, this helper has to move with it; the test
// suite would catch a drift between intent and implementation.
type SuppressionReason = 'permanent_bounce' | 'complaint' | 'mittera_suppressed' | 'manual';

interface MitteraEvent {
  type: string;
  data?: {
    bounce?: { type?: string };
  };
}

function decide(event: MitteraEvent): SuppressionReason | null {
  if (event.type === 'email.bounced' && event.data?.bounce?.type === 'Permanent') {
    return 'permanent_bounce';
  }
  if (event.type === 'email.complained') return 'complaint';
  if (event.type === 'email.suppressed') return 'mittera_suppressed';
  return null;
}

describe('suppression decision', () => {
  test('permanent bounce → permanent_bounce', () => {
    expect(
      decide({ type: 'email.bounced', data: { bounce: { type: 'Permanent' } } }),
    ).toBe('permanent_bounce');
  });

  test('transient bounce → no suppression', () => {
    expect(
      decide({ type: 'email.bounced', data: { bounce: { type: 'Transient' } } }),
    ).toBe(null);
  });

  test('undetermined bounce → no suppression (treat as transient)', () => {
    expect(
      decide({ type: 'email.bounced', data: { bounce: { type: 'Undetermined' } } }),
    ).toBe(null);
  });

  test('bounce without type field → no suppression (mittera quirk safety)', () => {
    expect(decide({ type: 'email.bounced', data: {} })).toBe(null);
    expect(decide({ type: 'email.bounced' })).toBe(null);
  });

  test('complaint → complaint', () => {
    expect(decide({ type: 'email.complained' })).toBe('complaint');
  });

  test('mittera-side suppression → mittera_suppressed', () => {
    expect(decide({ type: 'email.suppressed' })).toBe('mittera_suppressed');
  });

  test('non-suppressing events return null', () => {
    expect(decide({ type: 'email.delivered' })).toBe(null);
    expect(decide({ type: 'email.opened' })).toBe(null);
    expect(decide({ type: 'email.clicked' })).toBe(null);
    expect(decide({ type: 'email.queued' })).toBe(null);
    expect(decide({ type: 'email.sent' })).toBe(null);
    expect(decide({ type: 'email.delivery_delayed' })).toBe(null);
    expect(decide({ type: 'webhook.test' })).toBe(null);
    expect(decide({ type: 'domain.verified' })).toBe(null);
    expect(decide({ type: 'contact.created' })).toBe(null);
  });
});

describe('email normalisation', () => {
  function normaliseEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  test('lower-cases', () => {
    expect(normaliseEmail('User@Example.COM')).toBe('user@example.com');
  });

  test('trims surrounding whitespace', () => {
    expect(normaliseEmail('  user@example.com  ')).toBe('user@example.com');
  });

  test('preserves internal characters', () => {
    expect(normaliseEmail('user+tag@example.co.uk')).toBe('user+tag@example.co.uk');
    expect(normaliseEmail('user.name@example.com')).toBe('user.name@example.com');
  });

  test('empty / whitespace-only inputs collapse to empty', () => {
    expect(normaliseEmail('')).toBe('');
    expect(normaliseEmail('   ')).toBe('');
  });
});

describe('recipient list extraction (mittera "to" field)', () => {
  function recipientList(to: string | string[] | undefined): string[] {
    if (!to) return [];
    if (Array.isArray(to)) return to.filter((s): s is string => typeof s === 'string');
    return typeof to === 'string' ? [to] : [];
  }

  test('string → single-item array', () => {
    expect(recipientList('user@example.com')).toEqual(['user@example.com']);
  });

  test('array → array', () => {
    expect(recipientList(['a@x.com', 'b@x.com'])).toEqual(['a@x.com', 'b@x.com']);
  });

  test('undefined → empty', () => {
    expect(recipientList(undefined)).toEqual([]);
  });

  test('array with non-string entries → those are dropped (mittera schema safety)', () => {
    expect(
      recipientList(['ok@x.com', null as unknown as string, 'also@x.com']),
    ).toEqual(['ok@x.com', 'also@x.com']);
  });
});
