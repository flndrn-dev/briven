import { describe, expect, test } from 'bun:test';

import { sanitizeErrorMessage } from './error-sanitizer.js';

describe('error-sanitizer', () => {
  test('strips /tmp/briven-isolate-* paths', () => {
    const input = "TypeError at /tmp/briven-isolate-abc123/briven/functions/poolStats.ts:42:18";
    expect(sanitizeErrorMessage(input, [])).toBe(
      'TypeError at <bundle>/briven/functions/poolStats.ts:42:18',
    );
  });

  test('strips IPv4 addresses', () => {
    expect(sanitizeErrorMessage('connect ECONNREFUSED 10.0.0.1:5432', [])).toBe(
      'connect ECONNREFUSED <ip>:5432',
    );
  });

  test('strips IPv6 addresses', () => {
    expect(sanitizeErrorMessage('connect to fe80::1', [])).toBe('connect to <ip>');
  });

  test('strips env-var values', () => {
    const input = 'auth failed: token=sk_live_abc123';
    expect(sanitizeErrorMessage(input, ['sk_live_abc123', 'other'])).toBe(
      'auth failed: token=<redacted>',
    );
  });

  test('truncates to 2 KB', () => {
    const long = 'x'.repeat(3000);
    const out = sanitizeErrorMessage(long, []);
    expect(out.length).toBeLessThanOrEqual(2048);
    expect(out.endsWith('…')).toBe(true);
  });

  test('passes short safe messages unchanged', () => {
    expect(sanitizeErrorMessage('something went wrong', [])).toBe('something went wrong');
  });

  test('strips IPv6 leading-:: addresses including ::1', () => {
    expect(sanitizeErrorMessage('connect to ::1', [])).toBe('connect to <ip>');
    expect(sanitizeErrorMessage('connect to ::', [])).toBe('connect to <ip>');
  });

  test('handles paths, IPs, and env-values together', () => {
    expect(sanitizeErrorMessage(
      'fetch /tmp/briven-isolate-x7k2/h.ts -> 10.0.0.1: token=sk_live_abc123',
      ['sk_live_abc123'],
    )).toBe('fetch <bundle>/h.ts -> <ip>: token=<redacted>');
  });
});
