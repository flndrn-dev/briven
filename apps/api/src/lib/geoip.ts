import { open, type CityResponse, type Reader } from 'maxmind';

import { env } from '../env.js';
import { log } from './logger.js';

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
      log.warn('geoip_db_open_failed', { path: env.BRIVEN_GEOIP_DB_PATH, message: err instanceof Error ? err.message : String(err) });
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

async function lookupViaIpApi(ip: string): Promise<GeoLookup | null> {
  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=city,regionName,country`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { city?: string; regionName?: string; country?: string };
    const city = data.city ?? null;
    const region = data.regionName ?? null;
    const country = data.country ?? null;
    if (!city && !region && !country) return null;
    return { city, region, country };
  } catch {
    return null;
  }
}

export async function lookupIp(ip: string | null | undefined): Promise<GeoLookup | null> {
  if (!ip) return null;
  if (isPrivateIp(ip)) return null;
  const reader = await getReader();
  if (reader) {
    try {
      const response = reader.get(ip);
      if (response) {
        const city = response.city?.names?.en ?? null;
        const region = response.subdivisions?.[0]?.names?.en ?? null;
        const country = response.country?.names?.en ?? response.registered_country?.names?.en ?? null;
        if (city || region || country) return { city, region, country };
      }
    } catch {}
  }
  return lookupViaIpApi(ip);
}
