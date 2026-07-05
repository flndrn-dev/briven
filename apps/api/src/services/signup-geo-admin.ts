import { and, desc, eq, gte, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { authSignupGeo } from '../db/schema.js';

/**
 * Admin-only aggregation over auth_signup_geo (platform-wide sign-up geo).
 * Powers the "sign-ups · geo (SEO)" cockpit page. Returns:
 *   - total sign-ups in the window
 *   - counts grouped by country
 *   - counts grouped by country + city
 *   - a recent-events list (raw IPs included — admin-only, the whole point)
 *
 * Optional filters mirror other admin analytics endpoints: `?projectId=` and
 * a `?days=` time window (default 30, clamped 1..365).
 */

export interface CountryCount {
  country: string | null;
  count: number;
}

export interface CityCount {
  country: string | null;
  city: string | null;
  count: number;
}

export interface RecentSignup {
  id: string;
  projectId: string;
  userId: string | null;
  email: string | null;
  ip: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  createdAt: string;
}

export interface SignupGeoSummary {
  total: number;
  byCountry: CountryCount[];
  byCity: CityCount[];
  recent: RecentSignup[];
  sinceDays: number;
  projectId: string | null;
  /** True when every geo field on every row in the window is null — i.e. the
   *  GeoLite2 .mmdb isn't installed yet. Lets the UI show a "geo pending" note
   *  instead of reading as "everyone is from nowhere". */
  geoPending: boolean;
}

export async function getSignupGeoSummary(opts: {
  sinceDays?: number;
  projectId?: string | null;
} = {}): Promise<SignupGeoSummary> {
  const db = getDb();
  const sinceDays = Math.max(1, Math.min(365, opts.sinceDays ?? 30));
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const projectId = opts.projectId?.trim() || null;

  const where = projectId
    ? and(gte(authSignupGeo.createdAt, since), eq(authSignupGeo.projectId, projectId))
    : gte(authSignupGeo.createdAt, since);

  const [byCountryRows, byCityRows, recentRows] = await Promise.all([
    db
      .select({
        country: authSignupGeo.country,
        count: sql<number>`count(*)`,
      })
      .from(authSignupGeo)
      .where(where)
      .groupBy(authSignupGeo.country)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({
        country: authSignupGeo.country,
        city: authSignupGeo.city,
        count: sql<number>`count(*)`,
      })
      .from(authSignupGeo)
      .where(where)
      .groupBy(authSignupGeo.country, authSignupGeo.city)
      .orderBy(desc(sql`count(*)`)),
    db
      .select()
      .from(authSignupGeo)
      .where(where)
      .orderBy(desc(authSignupGeo.createdAt))
      .limit(100),
  ]);

  const byCountry: CountryCount[] = byCountryRows.map((r) => ({
    country: r.country,
    count: Number(r.count),
  }));
  const byCity: CityCount[] = byCityRows.map((r) => ({
    country: r.country,
    city: r.city,
    count: Number(r.count),
  }));
  const total = byCountry.reduce((sum, r) => sum + r.count, 0);

  const recent: RecentSignup[] = recentRows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    userId: r.userId,
    email: r.email,
    ip: r.ip,
    country: r.country,
    city: r.city,
    region: r.region,
    createdAt: r.createdAt.toISOString(),
  }));

  const geoPending =
    recent.length > 0 && recent.every((r) => !r.country && !r.city && !r.region);

  return { total, byCountry, byCity, recent, sinceDays, projectId, geoPending };
}
