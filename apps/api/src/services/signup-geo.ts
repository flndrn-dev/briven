import { newId } from '@briven/shared';

import { getDb } from '../db/client.js';
import { authSignupGeo } from '../db/schema.js';
import { lookupIp } from '../lib/geoip.js';
import { log } from '../lib/logger.js';

/**
 * Platform-wide sign-up geo capture (admin-only SEO analytics).
 *
 * Called once per end-user sign-up from the per-tenant Better Auth
 * user.create hook. Does a self-hosted geo lookup (lib/geoip.ts, GeoLite2
 * .mmdb when BRIVEN_GEOIP_DB_PATH is set, HTTP fallback otherwise) and
 * inserts ONE row into the control-plane auth_signup_geo table.
 *
 * HARD rule: this must NEVER break sign-up. Every failure path (missing geo
 * DB, DB insert error, unparseable IP) is caught and logged at warn — the
 * caller does not await it in a way that blocks the auth response, and even
 * if it did, a throw here can't escape the try/catch below.
 */
export interface CaptureSignupGeoInput {
  projectId: string;
  userId: string;
  email: string | null;
  ip: string | null;
}

export async function captureSignupGeo(input: CaptureSignupGeoInput): Promise<void> {
  try {
    // lib/geoip.ts already handles: no-ip → null, private/localhost → null,
    // missing .mmdb → single warn + HTTP fallback, all fields undefined-safe.
    const geo = await lookupIp(input.ip);

    await getDb()
      .insert(authSignupGeo)
      .values({
        id: newId('me'),
        projectId: input.projectId,
        userId: input.userId,
        email: input.email,
        ip: input.ip,
        country: geo?.country ?? null,
        city: geo?.city ?? null,
        region: geo?.region ?? null,
      });
  } catch (err) {
    // A geo/analytics miss must never surface to the signing-up user.
    log.warn('signup_geo_capture_failed', {
      projectId: input.projectId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
