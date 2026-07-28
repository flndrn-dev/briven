/**
 * Request context on every Briven Auth customer email:
 * Platform · Device location (city / region / country + IP) · Time (Europe/Brussels).
 *
 * SuperTokens-style security meta so users can spot unexpected logins.
 * Geo: self-hosted MaxMind GeoLite2 + offline nearest-city fallback — no third-party API.
 *
 * Icons: Lucide SVG (same design system as lucide-animated.com). Email clients
 * cannot run React/Motion animations, so we embed static Lucide strokes.
 *
 * Target display (flndrn 2026-07-28):
 *   Platform: Brave browser on macOS device
 *   Device location: Ghent, East Flanders, Belgium (109.128.54.152)
 *   Time: July 25, 2026 at 10:48:35 AM GMT+2
 */

import { lookupIp } from '../../lib/geoip.js';
import { nearestCityFromCoords } from './nearest-city.js';

/** Default timezone for Auth email timestamps (flndrn / EU ops). */
export const AUTH_EMAIL_TIMEZONE = 'Europe/Brussels';

export type AuthEmailRequestMeta = {
  /** e.g. "Brave browser on macOS device" */
  platform: string;
  /** e.g. "Ghent, East Flanders, Belgium (109.128.54.152)" */
  deviceLocation: string;
  /** e.g. "July 25, 2026 at 10:48:35 AM GMT+2" */
  time: string;
};

/**
 * Parse browser from User-Agent and optional Sec-CH-UA client hints.
 * Brave must be checked before Chrome (Brave UAs often include Chrome/).
 */
export function formatAuthEmailPlatform(
  userAgent: string | null | undefined,
  clientHintsUa?: string | null,
): string {
  const ua = userAgent ?? '';
  const ch = clientHintsUa ?? '';
  if (!ua.trim() && !ch.trim()) return 'Unknown browser on unknown device';

  // Client Hints brand list: "Not A(Brand";v="99", "Brave";v="121", "Chromium";v="121"
  const brandFromHints = (): string | null => {
    if (!ch.trim()) return null;
    // Quoted brands — match Brave before Chromium/Google Chrome
    if (/"Brave"/i.test(ch) || /,\s*Brave;/i.test(ch)) return 'Brave';
    if (/"Microsoft Edge"/i.test(ch) || /"Edge"/i.test(ch)) return 'Edge';
    if (/"Opera"/i.test(ch) || /"Opera GX"/i.test(ch)) return 'Opera';
    if (/"Firefox"/i.test(ch)) return 'Firefox';
    if (/"Google Chrome"/i.test(ch) || /"Chrome"/i.test(ch)) return 'Chrome';
    if (/"Chromium"/i.test(ch) && !/"Google Chrome"/i.test(ch)) return 'Chrome';
    if (/"Safari"/i.test(ch)) return 'Safari';
    return null;
  };

  let browser = brandFromHints() ?? 'Unknown browser';
  if (browser === 'Unknown browser' && ua.trim()) {
    // Order matters: Brave/Edge/Opera before Chrome; Samsung before Chrome.
    if (/Brave\//i.test(ua) || /\bBrave\b/i.test(ua)) browser = 'Brave';
    else if (/Edg\//i.test(ua)) browser = 'Edge';
    else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
    else if (/Firefox\//i.test(ua) || /FxiOS\//i.test(ua)) browser = 'Firefox';
    else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';
    else if (/CriOS\//i.test(ua)) browser = 'Chrome';
    else if (/Chrome\//i.test(ua) && /Safari\//i.test(ua)) browser = 'Chrome';
    else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';
  }

  let device = 'unknown';
  if (/iPhone/i.test(ua)) device = 'iPhone';
  else if (/iPad/i.test(ua)) device = 'iPad';
  else if (/Android/i.test(ua)) device = 'Android';
  else if (/CrOS/i.test(ua)) device = 'ChromeOS';
  else if (/Mac OS X|Macintosh/i.test(ua)) device = 'macOS';
  else if (/Windows NT/i.test(ua)) device = 'Windows';
  else if (/Linux/i.test(ua)) device = 'Linux';

  // "Brave browser on macOS device"
  return `${browser} browser on ${device} device`;
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
  let s = raw.trim();
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    if (end > 0) return s.slice(1, end);
  }
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(s)) return s.split(':')[0]!;
  return s;
}

function isPlausibleIp(ip: string): boolean {
  const s = stripIp(ip);
  if (!s || s.length > 45) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return true;
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
 * Example: "July 25, 2026 at 10:48:35 AM GMT+2"
 */
export function formatAuthEmailTime(
  when: Date = new Date(),
  timeZone: string = AUTH_EMAIL_TIMEZONE,
): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZoneName: 'shortOffset',
    }).formatToParts(when);
    const get = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((p) => p.type === type)?.value ?? '';
    const month = get('month');
    const day = get('day');
    const year = get('year');
    const hour = get('hour');
    const minute = get('minute');
    const second = get('second');
    const dayPeriod = get('dayPeriod'); // AM / PM
    let tz = get('timeZoneName') || '';
    // Normalize "GMT+2" / "UTC+2" → "GMT+2"
    tz = tz.replace(/^UTC/, 'GMT').replace(/\s+/g, '');
    // July 25, 2026 at 10:48:35 AM GMT+2
    return `${month} ${day}, ${year} at ${hour}:${minute}:${second} ${dayPeriod}${tz ? ` ${tz}` : ''}`.trim();
  } catch {
    return when.toISOString();
  }
}

/**
 * Device location line: "City, Region, Country (IP)"
 * Prefer MaxMind city; if missing, nearest offline city from lat/lon.
 */
export function formatAuthEmailDeviceLocation(
  geo: {
    city: string | null;
    region: string | null;
    country: string | null;
    latitude?: number | null;
    longitude?: number | null;
    accuracyRadiusKm?: number | null;
  } | null,
  ip: string | null | undefined,
): string {
  let city = geo?.city?.trim() || null;
  let region = geo?.region?.trim() || null;
  const country = geo?.country?.trim() || null;

  // MaxMind often returns country centroid with no city (e.g. BE ISP ranges →
  // Brussels coords only). Fill nearest known city offline.
  if (!city && geo?.latitude != null && geo?.longitude != null) {
    const maxKm = Math.max(120, (geo.accuracyRadiusKm ?? 50) * 2);
    const near = nearestCityFromCoords(geo.latitude, geo.longitude, maxKm);
    if (near) {
      city = near.name;
      if (!region && near.region) region = near.region;
    }
  }

  const placeParts: string[] = [];
  if (city) placeParts.push(city);
  if (region && region !== city) placeParts.push(region);
  if (country && country !== city && country !== region) placeParts.push(country);
  const place = placeParts.join(', ');
  const ipPart = ip?.trim() || null;

  if (place && ipPart) return `${place} (${ipPart})`;
  if (place) return place;
  if (ipPart) return `Location unavailable (${ipPart})`;
  return 'Location unavailable';
}

/**
 * Resolve full meta block for an outbound Auth email.
 * `when` defaults to now = the actual send moment.
 */
export async function resolveAuthEmailRequestMeta(input: {
  userAgent?: string | null;
  /** Sec-CH-UA client hint — needed to distinguish Brave from Chrome. */
  clientHintsUa?: string | null;
  clientIp?: string | null;
  when?: Date;
  timeZone?: string;
}): Promise<AuthEmailRequestMeta> {
  const sentAt = input.when ?? new Date();
  const ip = input.clientIp?.trim() || null;
  const geo = ip ? await lookupIp(ip) : null;
  return {
    platform: formatAuthEmailPlatform(input.userAgent, input.clientHintsUa),
    deviceLocation: formatAuthEmailDeviceLocation(geo, ip),
    time: formatAuthEmailTime(sentAt, input.timeZone),
  };
}

/**
 * Official Lucide outline icons (static first frame of lucide-animated.com).
 *
 * Source of truth for shapes:
 *   https://lucide-animated.com/icons/monitor
 *   https://lucide-animated.com/icons/map-pin
 *   https://lucide-animated.com/icons/clock
 * Path data matches lucide-static (ISC) — same geometry the animated set uses.
 *
 * Email cannot run Motion hover animations, so we embed the static Lucide SVG
 * (no emoji — flndrn rule). Layout: icon column | label | value for clean align.
 */
type LucideEmailIcon = 'monitor' | 'map-pin' | 'clock';

/** Exact Lucide path geometry (viewBox 0 0 24 24). */
const LUCIDE_PATHS: Record<LucideEmailIcon, string> = {
  // https://lucide-animated.com/icons/monitor + lucide-static monitor.svg
  monitor:
    '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  // https://lucide-animated.com/icons/map-pin + lucide-static map-pin.svg
  'map-pin':
    '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  // https://lucide-animated.com/icons/clock + lucide-static clock.svg
  clock:
    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
};

function lucideIcon(kind: LucideEmailIcon): string {
  // 18×18, 1.75 stroke — crisper in Gmail/Apple Mail than 16/2.
  // Explicit hex stroke (not currentColor) so clients that ignore CSS still paint.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true" focusable="false" style="display:block;width:18px;height:18px;min-width:18px">${LUCIDE_PATHS[kind]}</svg>`;
}

/** HTML meta block with Lucide icons (no emoji). Labels match the product copy. */
export function authEmailRequestMetaHtml(meta: AuthEmailRequestMeta): string {
  const font =
    "font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  const row = (label: string, value: string, icon: LucideEmailIcon) =>
    `<tr>
      <td style="padding:8px 10px 8px 0;vertical-align:middle;width:18px">${lucideIcon(icon)}</td>
      <td style="padding:8px 12px 8px 0;vertical-align:middle;white-space:nowrap;color:#9ca3af;font-size:13px;line-height:18px;${font}">${escapeHtml(label)}</td>
      <td style="padding:8px 0;vertical-align:middle;color:#e5e7eb;font-size:13px;line-height:18px;${font}">${escapeHtml(value)}</td>
    </tr>`;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0 0;width:100%;border-collapse:collapse;border-top:1px solid #1e2128">
      <tr><td colspan="3" style="height:16px;line-height:16px;font-size:0">&nbsp;</td></tr>
      ${row('Platform', meta.platform, 'monitor')}
      ${row('Device location', meta.deviceLocation, 'map-pin')}
      ${row('Time', meta.time, 'clock')}
    </table>`;
}

export function authEmailRequestMetaText(meta: AuthEmailRequestMeta): string {
  return [
    `Platform: ${meta.platform}`,
    `Device location: ${meta.deviceLocation}`,
    `Time: ${meta.time}`,
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
