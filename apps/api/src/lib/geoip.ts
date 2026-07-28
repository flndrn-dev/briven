import { existsSync } from 'node:fs';

import { open, type CityResponse, type Reader } from 'maxmind';

import { env } from '../env.js';
import { log } from './logger.js';

export interface GeoLookup {
  city: string | null;
  region: string | null;
  country: string | null;
}

let readerPromise: Promise<Reader<CityResponse> | null> | null = null;

/** Common install locations when BRIVEN_GEOIP_DB_PATH is unset. */
const GEOIP_CANDIDATES = [
  '/var/lib/GeoIP/GeoLite2-City.mmdb',
  '/usr/share/GeoIP/GeoLite2-City.mmdb',
  '/usr/local/share/GeoIP/GeoLite2-City.mmdb',
  '/data/geoip/GeoLite2-City.mmdb',
  '/app/data/GeoLite2-City.mmdb',
];

function resolveGeoipPath(): string | null {
  if (env.BRIVEN_GEOIP_DB_PATH?.trim()) return env.BRIVEN_GEOIP_DB_PATH.trim();
  for (const p of GEOIP_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function getReader(): Promise<Reader<CityResponse> | null> {
  if (!readerPromise) {
    const path = resolveGeoipPath();
    if (!path) {
      readerPromise = Promise.resolve(null);
      log.warn('geoip_db_missing', {
        message:
          'No GeoLite2-City.mmdb — set BRIVEN_GEOIP_DB_PATH so Auth emails can show city/country',
      });
      return null;
    }
    readerPromise = open<CityResponse>(path)
      .then((r) => {
        log.info('geoip_db_open_ok', { path });
        return r;
      })
      .catch((err: unknown) => {
        log.warn('geoip_db_open_failed', {
          path,
          message: err instanceof Error ? err.message : String(err),
        });
        return null;
      });
  }
  return readerPromise;
}

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

// SELF-HOSTED ONLY (flndrn decision, 2026-07-05): geo lookups NEVER leave this
// server. There is deliberately no third-party fallback (the old ip-api.com HTTP
// call was removed) — an IP that the local GeoLite2 DB can't resolve returns null
// and the caller records the raw IP with geo left blank ("pending") until the
// GeoLite2-City .mmdb file is installed at BRIVEN_GEOIP_DB_PATH.
export async function lookupIp(ip: string | null | undefined): Promise<GeoLookup | null> {
  if (!ip) return null;
  if (isPrivateIp(ip)) return null;
  const reader = await getReader();
  if (!reader) return null;
  try {
    const response = reader.get(ip);
    if (response) {
      const city = response.city?.names?.en ?? null;
      const region = response.subdivisions?.[0]?.names?.en ?? null;
      const country = response.country?.names?.en ?? response.registered_country?.names?.en ?? null;
      if (city || region || country) return { city, region, country };
    }
  } catch {
    // Local MaxMind DB read failure — return null; caller stores the raw IP only.
  }
  return null;
}
