import { open, type CityResponse, type Reader } from 'maxmind';

import { env } from '../env.js';
import { log } from './logger.js';

/**
 * IP → { city, region, country } lookup backed by a local MaxMind GeoLite2-City
 * database. No third-party call per lookup — the whole DB is mmap'd into the
 * API process on first use and queried synchronously.
 *
 * This product includes GeoLite2 data created by MaxMind, available from
 * https://www.maxmind.com. Download the free DB with a MaxMind account,
 * drop the `.mmdb` file on disk, and point BRIVEN_GEOIP_DB_PATH at it.
 *
 * When the DB is absent (dev boxes, self-hosters who don't want the binary),
 * every lookup returns null and the UI shows a dash. The feature is
 * strictly additive.
 */

export interface GeoLookup {
  city: string | null;
  region: string | null;
  country: string | null;
}

let readerPromise: Promise<Reader<CityResponse> | null> | null = null;

async function getReader(): Promise<Reader<CityResponse> | null> {
  if (!env.BRIVEN_GEOIP_DB_PATH) return null;
  if (!readerPromise) {
    readerPromise = open<CityResponse>(env.BRIVEN_GEOIP_DB_PATH).catch((err: unknown) => {
      log.warn('geoip_db_open_failed', {
        path: env.BRIVEN_GEOIP_DB_PATH,
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
  }
  return readerPromise;
}

/** Private / reserved ranges we never look up. */
function isPrivateIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.') || ip.startsWith('fc') || ip.startsWith('fe80:')) return true;
  if (ip.startsWith('172.')) {
    const second = Number(ip.split('.')[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/**
 * Returns `{city, region, country}` for the given IP, or `null` if:
 * - `ip` is null / empty
 * - the IP is private / reserved
 * - the DB is not configured or failed to open
 * - the DB has no data for this IP
 */
export async function lookupIp(ip: string | null | undefined): Promise<GeoLookup | null> {
  if (!ip) return null;
  if (isPrivateIp(ip)) return null;

  const reader = await getReader();
  if (!reader) return null;

  let response: CityResponse | null;
  try {
    response = reader.get(ip);
  } catch {
    // Malformed IP string — treat as no data.
    return null;
  }
  if (!response) return null;

  const city = response.city?.names?.en ?? null;
  const region = response.subdivisions?.[0]?.names?.en ?? null;
  const country = response.country?.names?.en ?? response.registered_country?.names?.en ?? null;

  if (!city && !region && !country) return null;
  return { city, region, country };
}
