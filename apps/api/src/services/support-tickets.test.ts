/**
 * Pure-unit tests for the support-ticket helpers that don't need a DB:
 *   - the routing-tag → topic-code parser
 *   - the ticket-number FORMAT (counter mocked / passed in)
 *
 * The DB-dependent paths — generateTicketNumber's atomic counter, the
 * create-path transaction, and every endpoint — need a live local DB and
 * are NOT covered here (integration-tested separately).
 */

import { describe, expect, test } from 'bun:test';

import {
  formatTicketNumber,
  parseRoutingTags,
  primaryTopicCode,
  renderTicketNumber,
  ticketDayKey,
} from './support-tickets.js';

describe('parseRoutingTags', () => {
  test('extracts routing tags in subject order', () => {
    expect(parseRoutingTags('#support #billing #technical #self-hosting')).toEqual([
      'support',
      'billing',
      'technical',
      'self-hosting',
    ]);
  });

  test('ignores non-routing chips and de-dupes', () => {
    expect(parseRoutingTags('#sales #support #support #urgent')).toEqual(['support']);
  });

  test('returns empty for no/blank/untagged subject', () => {
    expect(parseRoutingTags(null)).toEqual([]);
    expect(parseRoutingTags(undefined)).toEqual([]);
    expect(parseRoutingTags('')).toEqual([]);
    expect(parseRoutingTags('just a plain subject line')).toEqual([]);
  });

  test('is case-insensitive on the tag text', () => {
    expect(parseRoutingTags('#Support #BILLING')).toEqual(['support', 'billing']);
  });
});

describe('primaryTopicCode', () => {
  test('maps each routing tag to its code', () => {
    expect(primaryTopicCode('#support')).toBe('SUP');
    expect(primaryTopicCode('#billing')).toBe('BIL');
    expect(primaryTopicCode('#technical')).toBe('TEC');
    expect(primaryTopicCode('#self-hosting')).toBe('SLF');
  });

  test('uses the FIRST routing tag in the subject', () => {
    expect(primaryTopicCode('#billing #support')).toBe('BIL');
    expect(primaryTopicCode('#technical #billing #support')).toBe('TEC');
  });

  test('returns null when no routing tag is present', () => {
    expect(primaryTopicCode('#sales #partnerships')).toBeNull();
    expect(primaryTopicCode('hello there')).toBeNull();
    expect(primaryTopicCode(null)).toBeNull();
  });
});

describe('formatTicketNumber + renderTicketNumber', () => {
  const day = new Date('2026-06-29T12:00:00Z');

  test('formats <CODE><YYMMDD>-<6-digit counter> (no # in storage)', () => {
    expect(formatTicketNumber('SUP', day, 1)).toBe('SUP260629-000001');
  });

  test('renders the stored value with a leading # for API responses', () => {
    expect(renderTicketNumber(formatTicketNumber('SUP', day, 1))).toBe('#SUP260629-000001');
  });

  test('zero-pads the counter to 6 digits and grows past it', () => {
    expect(formatTicketNumber('BIL', day, 42)).toBe('BIL260629-000042');
    expect(formatTicketNumber('TEC', day, 123456)).toBe('TEC260629-123456');
  });

  test('uses UTC for the YYMMDD stamp', () => {
    // 23:30 UTC on the 29th stays the 29th regardless of host timezone.
    const lateUtc = new Date('2026-06-29T23:30:00Z');
    expect(formatTicketNumber('SLF', lateUtc, 7)).toBe('SLF260629-000007');
  });

  test('renderTicketNumber passes through null', () => {
    expect(renderTicketNumber(null)).toBeNull();
  });
});

describe('ticketDayKey', () => {
  test('is the UTC YYYY-MM-DD the counter resets on', () => {
    expect(ticketDayKey(new Date('2026-06-29T12:00:00Z'))).toBe('2026-06-29');
    expect(ticketDayKey(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-05');
  });
});
