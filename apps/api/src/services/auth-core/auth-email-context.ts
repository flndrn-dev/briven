/**
 * Request context shown on every Briven Auth customer email:
 * Platform · Device location (geo + IP) · Time (Europe/Brussels by default).
 *
 * Matches product security emails (e.g. SuperTokens-style meta block).
 * Geo uses the self-hosted MaxMind DB only (lib/geoip.ts) — never a third party.
 */

import { lookupIp } from '../../lib/geoip.js';

/** Default timezone for Auth email timestamps (flndrn / EU ops). */
export const AUTH_EMAIL_TIMEZONE = 'Europe/Brussels';

export type AuthEmailRequestMeta = {
  platform: string;
  deviceLocation: string;
  time: string;
};

/**
 * Human platform line: "Chrome browser on macOS device"
 * (matches security-email style in product screenshots).
 */
export function formatAuthEmailPlatform(
  userAgent: string | null | undefined,
): string {
  const ua = userAgent ?? '';
  const browser = /Firefox\//i.test(ua)
    ? 'Firefox browser'
    : /Edg\//i.test(ua)
      ? 'Edge browser'
      : /Chrome\//i.test(ua) && /Safari\//i.test(ua)
        ? 'Chrome browser'
        : /Safari\//i.test(ua)
          ? 'Safari browser'
          : /Opera|OPR\//i.test(ua)
            ? 'Opera browser'
            : ua.trim()
              ? 'Unknown browser'
              : 'Unknown browser';
  // iPhone/iPad before Mac — mobile Safari UAs often contain both.
  const device = /iPhone|iPad/i.test(ua)
    ? 'iOS device'
    : /Android/i.test(ua)
      ? 'Android device'
      : /Mac OS|Macintosh/i.test(ua)
        ? 'macOS device'
        : /Windows/i.test(ua)
          ? 'Windows device'
          : /Linux/i.test(ua)
            ? 'Linux device'
            : 'unknown device';
  return `${browser} on ${device}`;
}

/** Extract client IP from common reverse-proxy headers. */
export function clientIpFromHeaders(
  header: (name: string) => string | undefined | null,
): string | null {
  const cf = header('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const real = header('x-real-ip')?.trim();
  if (real) return real;
  const fwd = header('x-forwarded-for')?.split(',')[0]?.trim();
  if (fwd) return fwd;
  return null;
}

/**
 * "July 25, 2026 10:48:35 AM GMT+2" style, fixed to Europe/Brussels unless overridden.
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
      timeZoneName: 'short',
    }).formatToParts(when);
    const get = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((p) => p.type === type)?.value ?? '';
    const month = get('month');
    const day = get('day');
    const year = get('year');
    const hour = get('hour');
    const minute = get('minute');
    const second = get('second');
    const dayPeriod = get('dayPeriod');
    const tz = get('timeZoneName');
    // July 25, 2026 10:48:35 AM GMT+2
    return `${month} ${day}, ${year} ${hour}:${minute}:${second} ${dayPeriod} ${tz}`.trim();
  } catch {
    return when.toISOString();
  }
}

export function formatAuthEmailDeviceLocation(
  geo: { city: string | null; region: string | null; country: string | null } | null,
  ip: string | null | undefined,
): string {
  const place = [geo?.city, geo?.region, geo?.country].filter(Boolean).join(', ');
  const ipPart = ip?.trim() || null;
  if (place && ipPart) return `${place} (${ipPart})`;
  if (place) return place;
  if (ipPart) return `Unknown location (${ipPart})`;
  return 'Unknown location';
}

/**
 * Resolve full meta block for an outbound Auth email.
 * Safe when geo DB is missing — still shows IP + platform + time.
 */
export async function resolveAuthEmailRequestMeta(input: {
  userAgent?: string | null;
  clientIp?: string | null;
  when?: Date;
  timeZone?: string;
}): Promise<AuthEmailRequestMeta> {
  const ip = input.clientIp?.trim() || null;
  const geo = ip ? await lookupIp(ip) : null;
  return {
    platform: formatAuthEmailPlatform(input.userAgent),
    deviceLocation: formatAuthEmailDeviceLocation(geo, ip),
    time: formatAuthEmailTime(input.when ?? new Date(), input.timeZone),
  };
}

/** HTML block (icons optional via emoji for wide client support). */
export function authEmailRequestMetaHtml(meta: AuthEmailRequestMeta): string {
  const row = (label: string, value: string, icon: string) =>
    `<tr>
      <td style="padding:4px 0;color:#9ba3af;font-size:13px;vertical-align:top;white-space:nowrap;padding-right:10px">${icon} <span style="color:#6b7280">${escapeHtml(label)}:</span></td>
      <td style="padding:4px 0;color:#d1d5db;font-size:13px;vertical-align:top">${escapeHtml(value)}</td>
    </tr>`;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0 0;width:100%;border-top:1px solid #1e2128;padding-top:16px">
      ${row('Platform', meta.platform, '💻')}
      ${row('Device location', meta.deviceLocation, '📍')}
      ${row('Time', meta.time, '🕐')}
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
