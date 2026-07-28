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
import { nearestCityFromCoords } from './nearest-city.js';

describe('auth email request meta', () => {
  test('platform from Chrome on macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    expect(formatAuthEmailPlatform(ua)).toBe('Chrome browser on macOS device');
  });

  test('platform detects Brave from Sec-CH-UA even when UA looks like Chrome', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    const ch =
      '"Not A(Brand";v="8", "Chromium";v="126", "Brave";v="126"';
    expect(formatAuthEmailPlatform(ua, ch)).toBe(
      'Brave browser on macOS device',
    );
  });

  test('platform detects Brave from UA token', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Brave/126';
    expect(formatAuthEmailPlatform(ua)).toBe('Brave browser on macOS device');
  });

  test('platform from Safari on iPhone', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(formatAuthEmailPlatform(ua)).toBe(
      'Safari browser on iPhone device',
    );
  });

  test('device location with city + region + country + IP in parens', () => {
    expect(
      formatAuthEmailDeviceLocation(
        {
          city: 'Ghent',
          region: 'East Flanders',
          country: 'Belgium',
          latitude: 51.05,
          longitude: 3.72,
        },
        '109.128.54.152',
      ),
    ).toBe('Ghent, East Flanders, Belgium (109.128.54.152)');
  });

  test('device location nearest-city when MaxMind has only country + coords', () => {
    // Belgium country centroid (real MaxMind sample for 193.74.157.185)
    expect(
      formatAuthEmailDeviceLocation(
        {
          city: null,
          region: null,
          country: 'Belgium',
          latitude: 50.8509,
          longitude: 4.3447,
          accuracyRadiusKm: 100,
        },
        '193.74.157.185',
      ),
    ).toBe('Brussels, Belgium (193.74.157.185)');
  });

  test('device location IP only when geo missing', () => {
    expect(formatAuthEmailDeviceLocation(null, '1.2.3.4')).toBe(
      'Location unavailable (1.2.3.4)',
    );
  });

  test('nearestCityFromCoords maps Brussels centroid', () => {
    const n = nearestCityFromCoords(50.8509, 4.3447, 120);
    expect(n?.name).toBe('Brussels');
    expect(n?.country).toBe('Belgium');
  });

  test('time uses Europe/Brussels and US-style "at" format', () => {
    // 2026-07-25 08:48:35 UTC = 10:48:35 AM in Brussels (CEST, GMT+2)
    const t = formatAuthEmailTime(
      new Date('2026-07-25T08:48:35.000Z'),
      AUTH_EMAIL_TIMEZONE,
    );
    expect(t).toContain('July');
    expect(t).toContain('2026');
    expect(t).toContain('25');
    expect(t).toMatch(/10:48:35/);
    expect(t).toMatch(/\bAM\b/);
    expect(t).toContain(' at ');
    expect(t).toMatch(/GMT\+2|UTC\+2|\+02/);
  });

  test('html uses Platform / Device location / Time + Lucide SVG (no emoji)', () => {
    const meta = {
      platform: 'Brave browser on macOS device',
      deviceLocation: 'Ghent, East Flanders, Belgium (109.128.54.152)',
      time: 'July 25, 2026 at 10:48:35 AM GMT+2',
    };
    const html = authEmailRequestMetaHtml(meta);
    expect(html).toContain('Platform');
    expect(html).toContain('Device location');
    expect(html).toContain('Time');
    expect(html).toContain('Brave browser on macOS device');
    expect(html).toContain('109.128.54.152');
    // Official Lucide path fragments (monitor / map-pin / clock)
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('width="18"');
    expect(html).toContain('rect width="20" height="14"'); // monitor
    expect(html).toContain('M20 10c0 4.993'); // map-pin
    expect(html).toContain('polyline points="12 6 12 12 16 14"'); // clock
    expect(html).not.toContain('Device &amp; browser');
    expect(html).not.toContain('Sent at');
    // Never emoji — flndrn rule (lucide-animated.com shapes only)
    expect(html).not.toContain('💻');
    expect(html).not.toContain('📍');
    expect(html).not.toContain('🕐');
    expect(html).not.toContain('🖥');
    expect(html).not.toContain('🌍');
    expect(html).not.toContain('<script>');

    const text = authEmailRequestMetaText(meta);
    expect(text).toContain('Platform: Brave browser on macOS device');
    expect(text).toContain('Device location: Ghent');
    expect(text).toContain('Time: July 25');
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
