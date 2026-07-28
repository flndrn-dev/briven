import { describe, expect, test } from 'bun:test';

import {
  AUTH_EMAIL_TIMEZONE,
  authEmailRequestMetaHtml,
  authEmailRequestMetaText,
  clientIpFromHeaders,
  formatAuthEmailDeviceLocation,
  formatAuthEmailPlatform,
  formatAuthEmailTime,
} from './auth-email-context.js';

describe('auth email request meta', () => {
  test('platform from Chrome on macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    expect(formatAuthEmailPlatform(ua)).toBe('Chrome on macOS');
  });

  test('platform from Safari on iPhone', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(formatAuthEmailPlatform(ua)).toBe('Safari on iPhone');
  });

  test('device location with geo + IP', () => {
    expect(
      formatAuthEmailDeviceLocation(
        { city: 'Ghent', region: 'East Flanders', country: 'Belgium' },
        '109.128.54.152',
      ),
    ).toBe('Ghent, Belgium · 109.128.54.152');
  });

  test('device location IP only when geo missing', () => {
    expect(formatAuthEmailDeviceLocation(null, '1.2.3.4')).toBe(
      'Location unavailable · 1.2.3.4',
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
    expect(t).toMatch(/10:48:35/);
    expect(t).toMatch(/GMT\+2|UTC\+2|\+02/);
  });

  test('html uses Lucide SVG icons not emoji and Sent at label', () => {
    const meta = {
      platform: 'Chrome on macOS',
      deviceLocation: 'Ghent, Belgium · 109.128.54.152',
      time: '28 July 2026, 12:10:23 (GMT+2)',
    };
    const html = authEmailRequestMetaHtml(meta);
    expect(html).toContain('Device &amp; browser');
    expect(html).toContain('Location');
    expect(html).toContain('Sent at');
    expect(html).toContain('Chrome on macOS');
    expect(html).toContain('109.128.54.152');
    expect(html).toContain('<svg');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).not.toContain('💻');
    expect(html).not.toContain('📍');
    expect(html).not.toContain('🕐');
    expect(html).not.toContain('<script>');

    const text = authEmailRequestMetaText(meta);
    expect(text).toContain('Device & browser: Chrome on macOS');
    expect(text).toContain('Location: Ghent');
    expect(text).toContain('Sent at: 28 July');
  });

  test('clientIpFromHeaders prefers x-briven-client-ip', () => {
    const h = (n: string) => {
      if (n === 'x-briven-client-ip') return '203.0.113.50';
      if (n === 'x-forwarded-for') return '10.0.0.1, 203.0.113.50';
      return null;
    };
    expect(clientIpFromHeaders(h)).toBe('203.0.113.50');
  });

  test('clientIpFromHeaders skips private hop for public client', () => {
    const h = (n: string) => {
      if (n === 'x-forwarded-for') return '10.0.0.5, 203.0.113.99';
      return null;
    };
    expect(clientIpFromHeaders(h)).toBe('203.0.113.99');
  });
});
