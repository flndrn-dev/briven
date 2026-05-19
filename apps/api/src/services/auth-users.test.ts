import { describe, expect, test } from 'bun:test';

import {
  domainHintFromEmail,
  nameInitialFrom,
  redactUserRow,
} from './auth-users.js';

describe('auth-users — redaction (CLAUDE.md §5.1 + BUILD_PLAN.md §4)', () => {
  // ─── domainHintFromEmail ────────────────────────────────────────────

  test('extracts the domain portion of an email', () => {
    expect(domainHintFromEmail('alice@gmail.com')).toBe('gmail.com');
    expect(domainHintFromEmail('bob@mail.acme.co.uk')).toBe('mail.acme.co.uk');
  });

  test('lowercases the returned domain', () => {
    expect(domainHintFromEmail('Bob@GMAIL.com')).toBe('gmail.com');
  });

  test('returns "?" for malformed input', () => {
    expect(domainHintFromEmail('no-at-sign')).toBe('?');
    expect(domainHintFromEmail('trailing@')).toBe('?');
  });

  test('does NOT include the local part — privacy boundary', () => {
    const out = domainHintFromEmail('alice.particularly.sensitive@example.com');
    expect(out).toBe('example.com');
    expect(out).not.toContain('alice');
    expect(out).not.toContain('particularly');
    expect(out).not.toContain('sensitive');
  });

  // ─── nameInitialFrom ────────────────────────────────────────────────

  test('returns the first character of name', () => {
    expect(nameInitialFrom('Alice')).toBe('A');
    expect(nameInitialFrom('jane doe')).toBe('j');
  });

  test('trims leading whitespace before extracting initial', () => {
    expect(nameInitialFrom('   Bob')).toBe('B');
  });

  test('returns null for empty/null/whitespace-only names', () => {
    expect(nameInitialFrom(null)).toBeNull();
    expect(nameInitialFrom('')).toBeNull();
    expect(nameInitialFrom('   ')).toBeNull();
  });

  test('handles unicode without splitting surrogate pairs', () => {
    // emoji + multi-byte glyph: take the first grapheme cleanly
    expect(nameInitialFrom('🦊 alice')).toBe('🦊');
    expect(nameInitialFrom('Étienne')).toBe('É');
  });

  // ─── redactUserRow ──────────────────────────────────────────────────

  test('redactUserRow strips email + name; keeps id + providers + timestamps', () => {
    const out = redactUserRow({
      id: 'u_01HZABC',
      email: 'alice@gmail.com',
      name: 'Alice',
      createdAt: '2026-05-19T10:00:00.000Z',
      lastSeenAt: '2026-05-19T11:00:00.000Z',
      providerIds: ['google', 'passkey'],
    });
    expect(out).toEqual({
      id: 'u_01HZABC',
      emailDomainHint: 'gmail.com',
      nameInitial: 'A',
      providerIds: ['google', 'passkey'],
      lastSeenAt: '2026-05-19T11:00:00.000Z',
      createdAt: '2026-05-19T10:00:00.000Z',
    });
  });

  test('redactUserRow output never contains the original email local part', () => {
    const out = redactUserRow({
      id: 'u_x',
      email: 'super.secret.recipient@example.com',
      name: 'Super Secret',
      createdAt: '2026-05-19T10:00:00.000Z',
      lastSeenAt: null,
      providerIds: [],
    });
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain('super.secret');
    expect(serialised).not.toContain('recipient');
    expect(serialised).toContain('example.com');
  });

  test('redactUserRow output never contains the original full name (only initial)', () => {
    const out = redactUserRow({
      id: 'u_x',
      email: 'a@b.test',
      name: 'Veronica Mars',
      createdAt: '2026-05-19T10:00:00.000Z',
      lastSeenAt: null,
      providerIds: [],
    });
    const serialised = JSON.stringify(out);
    expect(serialised).toContain('"nameInitial":"V"');
    expect(serialised).not.toContain('Mars');
    expect(serialised).not.toContain('Veronica');
  });

  test('redactUserRow passes lastSeenAt null through unchanged', () => {
    const out = redactUserRow({
      id: 'u_x',
      email: 'a@b.test',
      name: null,
      createdAt: '2026-05-19T10:00:00.000Z',
      lastSeenAt: null,
      providerIds: [],
    });
    expect(out.lastSeenAt).toBeNull();
    expect(out.nameInitial).toBeNull();
  });
});
