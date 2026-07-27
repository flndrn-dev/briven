import { describe, expect, test } from 'bun:test';

import {
  AUTH_EMAIL_TIMEZONE,
  authEmailRequestMetaHtml,
  authEmailRequestMetaText,
  formatAuthEmailDeviceLocation,
  formatAuthEmailPlatform,
  formatAuthEmailTime,
} from './auth-email-context.js';

describe('auth email request meta', () => {
  test('platform from Chrome on macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    expect(formatAuthEmailPlatform(ua)).toBe('Chrome browser on macOS device');
  });

  test('platform from Safari on iOS', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(formatAuthEmailPlatform(ua)).toBe('Safari browser on iOS device');
  });

  test('device location with geo + IP', () => {
    expect(
      formatAuthEmailDeviceLocation(
        { city: 'Ghent', region: 'East Flanders', country: 'Belgium' },
        '109.128.54.152',
      ),
    ).toBe('Ghent, East Flanders, Belgium (109.128.54.152)');
  });

  test('device location IP only when geo missing', () => {
    expect(formatAuthEmailDeviceLocation(null, '1.2.3.4')).toBe(
      'Unknown location (1.2.3.4)',
    );
  });

  test('time uses Europe/Brussels and fixed format pieces', () => {
    // 2026-07-25 08:48:35 UTC = 10:48:35 in Brussels (CEST, GMT+2)
    const t = formatAuthEmailTime(
      new Date('2026-07-25T08:48:35.000Z'),
      AUTH_EMAIL_TIMEZONE,
    );
    expect(t).toContain('July');
    expect(t).toContain('2026');
    expect(t).toContain('25');
    expect(t).toMatch(/AM|PM/);
    // Brussels summer is GMT+2 / CEST
    expect(t).toMatch(/GMT\+2|CEST|UTC\+2/);
  });

  test('html and text include all three labels', () => {
    const meta = {
      platform: 'Chrome browser on macOS device',
      deviceLocation: 'Ghent, East Flanders, Belgium (109.128.54.152)',
      time: 'July 25, 2026 10:48:35 AM GMT+2',
    };
    const html = authEmailRequestMetaHtml(meta);
    expect(html).toContain('Platform');
    expect(html).toContain('Device location');
    expect(html).toContain('Time');
    expect(html).toContain('Chrome browser on macOS device');
    expect(html).toContain('109.128.54.152');
    expect(html).not.toContain('<script>');

    const text = authEmailRequestMetaText(meta);
    expect(text).toContain('Platform: Chrome browser on macOS device');
    expect(text).toContain('Device location: Ghent');
    expect(text).toContain('Time: July 25');
  });
});
