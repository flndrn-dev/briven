import { eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { platformSettings } from '../db/schema.js';
import { env } from '../env.js';

/**
 * Dashboard-controllable platform flags. Today: `openSignups`. Future
 * keys land here too.
 *
 * Reads are cached in-process for `CACHE_TTL_MS` so the auth hot path
 * (every signup attempt) doesn't roundtrip to the DB per request.
 * Writes invalidate the local cache; on multi-instance deployments the
 * peer instance picks up the change within the TTL window — fine for
 * flag-flip semantics where eventual consistency on the order of a
 * minute is acceptable.
 */

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export async function getPlatformSetting<T>(key: string, fallback: T): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  const db = getDb();
  const rows = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, key))
    .limit(1);
  const value = rows[0]?.value;
  if (value === undefined) {
    // Cache the fallback so repeated misses don't hammer the DB. The
    // setter invalidates this on every write.
    cache.set(key, { value: fallback, expiresAt: now + CACHE_TTL_MS });
    return fallback;
  }
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value as T;
}

export async function setPlatformSetting(
  key: string,
  value: unknown,
  updatedBy: string | null,
): Promise<void> {
  const db = getDb();
  await db
    .insert(platformSettings)
    .values({ key, value, updatedBy })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value, updatedAt: new Date(), updatedBy },
    });
  cache.delete(key);
}

export function invalidatePlatformSettingCache(key: string): void {
  cache.delete(key);
}

/**
 * Effective open-signups flag. DB takes precedence over the env var;
 * the env stays as the bootstrap default before the first dashboard
 * flip ever lands a row.
 */
export async function getOpenSignupsFlag(): Promise<boolean> {
  const dbValue = await getPlatformSetting<unknown>('openSignups', undefined);
  if (typeof dbValue === 'boolean') return dbValue;
  return env.BRIVEN_OPEN_SIGNUPS;
}

/**
 * Scheduled maintenance window, stored under `platform_settings.maintenanceWindow`.
 * All timestamps are ISO date-time strings (or null when unset).
 */
export interface MaintenanceWindow {
  startsAt: string | null;
  endsAt: string | null;
  message: string | null;
}

/**
 * Effective maintenance state, derived from two platform_settings keys:
 *   - `maintenanceMode` (bool)  — manual immediate override (back-compat).
 *   - `maintenanceWindow` (json) — { startsAt, endsAt, message }.
 *
 * Times are compared as Date.parse of ISO strings (pure JS date math — no
 * DB date params, per the Bun sql`` gotcha).
 *   - scheduled = startsAt != null && endsAt != null
 *   - active    = manualOverride  OR  (scheduled && now >= startsAt && now < endsAt)
 *   - upcoming  = scheduled && now < startsAt   (pre-announcement banner)
 */
export interface MaintenanceState {
  active: boolean;
  scheduled: boolean;
  upcoming: boolean;
  startsAt: string | null;
  endsAt: string | null;
  message: string | null;
}

export async function getMaintenanceState(): Promise<MaintenanceState> {
  const [manualOverride, window] = await Promise.all([
    getPlatformSetting<boolean>('maintenanceMode', false),
    getPlatformSetting<MaintenanceWindow | null>('maintenanceWindow', null),
  ]);

  const startsAt = window?.startsAt ?? null;
  const endsAt = window?.endsAt ?? null;
  const message = window?.message ?? null;

  const scheduled = startsAt !== null && endsAt !== null;
  const now = Date.now();
  const startMs = startsAt !== null ? Date.parse(startsAt) : NaN;
  const endMs = endsAt !== null ? Date.parse(endsAt) : NaN;

  const inWindow = scheduled && now >= startMs && now < endMs;
  const active = manualOverride === true || inWindow;
  const upcoming = scheduled && now < startMs;

  return { active, scheduled, upcoming, startsAt, endsAt, message };
}
