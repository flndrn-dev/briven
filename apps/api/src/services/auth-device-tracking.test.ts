import { describe, expect, test } from 'bun:test';

import { deviceFingerprint, deviceHint } from './auth-device-tracking.js';

describe('deviceFingerprint', () => {
  test('is stable for the same user-agent', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0 Safari/537.36';
    expect(deviceFingerprint(ua)).toBe(deviceFingerprint(ua));
  });

  test('differs across user-agents', () => {
    expect(deviceFingerprint('Chrome')).not.toBe(deviceFingerprint('Firefox'));
  });

  test('null / empty → same "unknown" bucket', () => {
    expect(deviceFingerprint(null)).toBe(deviceFingerprint(undefined));
    expect(deviceFingerprint(null)).toBe(deviceFingerprint(''));
  });
});

describe('deviceHint', () => {
  test('detects Chrome on macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    expect(deviceHint(ua)).toBe('Chrome on macOS');
  });

  test('detects Firefox on Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0';
    expect(deviceHint(ua)).toBe('Firefox on Windows');
  });

  test('detects Safari on iOS', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(deviceHint(ua)).toBe('Safari on iOS');
  });
});
