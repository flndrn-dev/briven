/**
 * Request context on every Briven Auth customer email:
 * Device & browser · Location (geo + IP) · Sent at (Europe/Brussels).
 *
 * SuperTokens-style security meta block.
 * Geo: self-hosted MaxMind GeoLite2 only (lib/geoip.ts) — no third-party API.
 *
 * Icons: Lucide SVG (same design system as lucide-animated.com). Email clients
 * cannot run React/Motion animations, so we embed static Lucide strokes —
 * professional, not emoji.
 */

import { lookupIp } from '../../lib/geoip.js';

/** Default timezone for Auth email timestamps (flndrn / EU ops). */
export const AUTH_EMAIL_TIMEZONE = 'Europe/Brussels';

export type AuthEmailRequestMeta = {
  /** e.g. "Chrome on macOS" */
  platform: string;
  /** e.g. "Ghent, Belgium · 109.128.54.152" */
  deviceLocation: string;
  /** e.g. "28 July 2026, 12:10:23 (GMT+2)" — always the send moment */
  time: string;
};

/**
 * Human device/browser line.
 * Prefer short professional form: "Chrome on macOS".
 */
export function formatAuthEmailPlatform(
  userAgent: string | null | undefined,
): string {
  const ua = userAgent ?? '';
  if (!ua.trim()) return 'Unknown browser · unknown device';

  // Order matters: Edge before Chrome (Edg/ also has Chrome/),
  // iOS Safari before Mac, Chromium browsers carefully.
  let browser = 'Unknown browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/CriOS\//i.test(ua)) browser = 'Chrome';
  else if (/FxiOS\//i.test(ua)) browser = 'Firefox';
  else if (/Chrome\//i.test(ua) && /Safari\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';

  let device = 'unknown device';
  if (/iPhone/i.test(ua)) device = 'iPhone';
  else if (/iPad/i.test(ua)) device = 'iPad';
  else if (/Android/i.test(ua)) device = 'Android';
  else if (/CrOS/i.test(ua)) device = 'ChromeOS';
  else if (/Mac OS X|Macintosh/i.test(ua)) device = 'macOS';
  else if (/Windows NT/i.test(ua)) device = 'Windows';
  else if (/Linux/i.test(ua)) device = 'Linux';

  return `${browser} on ${device}`;
}

/**
 * Extract client IP. Prefer explicit Briven header (set by first-party proxy),
 * then CDN / reverse-proxy headers. Skips obvious private hop when a public
 * address is also present in X-Forwarded-For.
 */
export function clientIpFromHeaders(
  header: (name: string) => string | undefined | null,
): string | null {
  const briven = header('x-briven-client-ip')?.trim();
  if (briven && isPlausibleIp(briven)) return stripIp(briven);

  const cf = header('cf-connecting-ip')?.trim();
  if (cf && isPlausibleIp(cf)) return stripIp(cf);

  const real = header('x-real-ip')?.trim();
  if (real && isPlausibleIp(real)) return stripIp(real);

  const forwarded = header('x-forwarded-for') ?? '';
  const parts = forwarded
    .split(',')
    .map((p) => stripIp(p.trim()))
    .filter((p) => p && isPlausibleIp(p));
  // Leftmost is the original client when proxies append.
  const publicPart = parts.find((p) => p && !isPrivateIp(p));
  if (publicPart) return publicPart;
  if (parts[0]) return parts[0];
  return null;
}

function stripIp(raw: string): string {
  // "[::1]:1234" or "1.2.3.4:5678"
  let s = raw.trim();
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    if (end > 0) return s.slice(1, end);
  }
  // IPv4 with port
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(s)) return s.split(':')[0]!;
  return s;
}

function isPlausibleIp(ip: string): boolean {
  const s = stripIp(ip);
  if (!s || s.length > 45) return false;
  // Basic IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return true;
  // Basic IPv6
  if (s.includes(':') && /^[0-9a-fA-F:.]+$/.test(s)) return true;
  return false;
}

function isPrivateIp(ip: string): boolean {
  const s = stripIp(ip);
  if (s === '127.0.0.1' || s === '::1' || s === 'localhost') return true;
  if (s.startsWith('10.') || s.startsWith('192.168.')) return true;
  if (s.startsWith('169.254.')) return true;
  if (s.startsWith('172.')) {
    const second = Number(s.split('.')[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/**
 * Human send time fixed to Europe/Brussels.
 * Example: "28 July 2026, 12:10:23 (GMT+2)"
 */
export function formatAuthEmailTime(
  when: Date = new Date(),
  timeZone: string = AUTH_EMAIL_TIMEZONE,
): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'shortOffset',
    }).formatToParts(when);
    const get = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((p) => p.type === type)?.value ?? '';
    const day = get('day');
    const month = get('month');
    const year = get('year');
    const hour = get('hour');
    const minute = get('minute');
    const second = get('second');
    let tz = get('timeZoneName') || '';
    // Normalize "GMT+2" style
    tz = tz.replace('UTC', 'GMT');
    if (tz && !tz.startsWith('(')) tz = `(${tz})`;
    // 28 July 2026, 12:10:23 (GMT+2)
    return `${day} ${month} ${year}, ${hour}:${minute}:${second}${tz ? ` ${tz}` : ''}`.trim();
  } catch {
    return when.toISOString();
  }
}

export function formatAuthEmailDeviceLocation(
  geo: { city: string | null; region: string | null; country: string | null } | null,
  ip: string | null | undefined,
): string {
  const city = geo?.city?.trim() || null;
  const region = geo?.region?.trim() || null;
  const country = geo?.country?.trim() || null;
  // Prefer city + country (skip region when it duplicates city noise)
  const placeParts: string[] = [];
  if (city) placeParts.push(city);
  else if (region) placeParts.push(region);
  if (country && country !== city) placeParts.push(country);
  const place = placeParts.join(', ');
  const ipPart = ip?.trim() || null;

  if (place && ipPart) return `${place} · ${ipPart}`;
  if (place) return place;
  if (ipPart) return `Location unavailable · ${ipPart}`;
  return 'Location unavailable';
}

/**
 * Resolve full meta block for an outbound Auth email.
 * `when` defaults to now = the actual send moment.
 */
export async function resolveAuthEmailRequestMeta(input: {
  userAgent?: string | null;
  clientIp?: string | null;
  when?: Date;
  timeZone?: string;
}): Promise<AuthEmailRequestMeta> {
  const sentAt = input.when ?? new Date();
  const ip = input.clientIp?.trim() || null;
  const geo = ip ? await lookupIp(ip) : null;
  return {
    platform: formatAuthEmailPlatform(input.userAgent),
    deviceLocation: formatAuthEmailDeviceLocation(geo, ip),
    time: formatAuthEmailTime(sentAt, input.timeZone),
  };
}

/** Lucide static SVG (same shapes as lucide-animated.com; email-safe). */
function lucideIcon(kind: 'monitor' | 'map-pin' | 'clock'): string {
  const common =
    'xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ba3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:6px"';
  if (kind === 'monitor') {
    return `<svg ${common} aria-hidden="true"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>`;
  }
  if (kind === 'map-pin') {
    return `<svg ${common} aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>`;
  }
  // clock
  return `<svg ${common} aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
}

/** HTML meta block with Lucide icons (no emoji). */
export function authEmailRequestMetaHtml(meta: AuthEmailRequestMeta): string {
  const row = (label: string, value: string, icon: 'monitor' | 'map-pin' | 'clock') =>
    `<tr>
      <td style="padding:6px 0;vertical-align:top;white-space:nowrap;padding-right:12px;width:1%">
        ${lucideIcon(icon)}
        <span style="color:#6b7280;font-size:13px;font-family:system-ui,-apple-system,sans-serif">${escapeHtml(label)}</span>
      </td>
      <td style="padding:6px 0;color:#d1d5db;font-size:13px;vertical-align:top;font-family:system-ui,-apple-system,sans-serif">${escapeHtml(value)}</td>
    </tr>`;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0 0;width:100%;border-top:1px solid #1e2128;padding-top:16px">
      ${row('Device & browser', meta.platform, 'monitor')}
      ${row('Location', meta.deviceLocation, 'map-pin')}
      ${row('Sent at', meta.time, 'clock')}
    </table>`;
}

export function authEmailRequestMetaText(meta: AuthEmailRequestMeta): string {
  return [
    `Device & browser: ${meta.platform}`,
    `Location: ${meta.deviceLocation}`,
    `Sent at: ${meta.time}`,
  ].join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
