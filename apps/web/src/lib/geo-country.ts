import { headers } from 'next/headers';
import ip3country from 'ip3country';

/**
 * Self-hosted IP → country lookup for the public /contact page.
 *
 * Uses ip3country — a tiny (<300KB), zero-dependency, embedded IP2Location
 * LITE table. Everything happens in-process: no external API call, no
 * account, no per-request network hop, so it can run inside a server
 * component on every render without leaking the visitor's IP to a third
 * party.
 *
 * The detected country drives the LOCKED "country" field on the contact
 * form — it is shown read-only and submitted alongside the message so an
 * operator can see where a request came from. It is a hint, never a hard
 * gate: when the IP can't be resolved (localhost, IPv6, private ranges,
 * unknown blocks) the field falls back to "unknown" and stays locked.
 */

export interface DetectedCountry {
  /** ISO 3166-1 alpha-2 country code, e.g. "US". */
  code: string;
  /** Human-readable English country name, e.g. "United States". */
  name: string;
}

// init() builds the lookup tables and is relatively CPU-heavy, so do it
// once per process and reuse it across requests.
let initialized = false;
function ensureInit(): void {
  if (!initialized) {
    ip3country.init();
    initialized = true;
  }
}

/** First, left-most IP in a comma-separated `x-forwarded-for` chain. */
function firstForwardedIp(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}

// ip3country resolves IPv4 dot-decimal addresses; anything else (IPv6,
// garbage) is skipped so we never surface a wrong country.
function isIpv4(ip: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
}

/** Map an ISO 3166-1 alpha-2 code to an English display name. */
function codeToName(code: string): string {
  try {
    const display = new Intl.DisplayNames(['en'], { type: 'region' });
    return display.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Resolve the current request's visitor country from request headers.
 * Reads the FIRST ip in `x-forwarded-for` (Traefik forwards the real
 * client there), falling back to `x-real-ip`. Returns null when the
 * country can't be determined (localhost, IPv6, unknown block) — the
 * caller then renders a locked "unknown" field.
 *
 * Server-only: relies on `next/headers`.
 */
export async function detectCountry(): Promise<DetectedCountry | null> {
  let ip: string | null = null;
  try {
    const h = await headers();
    ip = firstForwardedIp(h.get('x-forwarded-for')) ?? firstForwardedIp(h.get('x-real-ip'));
  } catch {
    return null;
  }
  if (!ip || !isIpv4(ip)) return null;

  ensureInit();
  let code: string | null = null;
  try {
    code = ip3country.lookupStr(ip);
  } catch {
    return null;
  }
  if (!code) return null;

  return { code, name: codeToName(code) };
}
