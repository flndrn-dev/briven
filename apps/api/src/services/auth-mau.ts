import { runInProjectDatabase } from '../db/data-plane.js';

import { getProjectTier, TIERS } from './tiers.js';

/**
 * Briven auth analytics — MAU, DAU, provider breakdown, signup velocity,
 * and session revocation metrics. Pulled at read time (dashboard hits these
 * endpoints when the Auth → Usage / Analytics pages load).
 */

export interface AuthMauStats {
  /** Distinct active users in the trailing 30 days. */
  count: number;
  /** Plan ceiling for the current tier (`TIERS[tier].authMauPerMonth`). */
  ceiling: number;
  /** Tier as it currently stands in `projects.tier`. */
  tier: 'free' | 'pro' | 'team';
  /** Window start (now - 30 days), ISO-8601. */
  windowStart: string;
  /** Window end (now), ISO-8601. */
  windowEnd: string;
  /** Fraction `count / ceiling`, clamped to [0, 2]. Soft-cap UI rendering. */
  usageFraction: number;
}

export interface AuthAnalyticsOverview {
  mau: AuthMauStats;
  dau: { count: number; date: string }[];
  newSignups: { count: number; date: string }[];
  totalUsers: number;
  activeSessions: number;
}

export interface ProviderBreakdown {
  email: number;
  magicLink: number;
  otp: number;
  oauth: number;
  passkey: number;
}

interface CountRow {
  count: number | string;
}

const WINDOW_DAYS = 30;

export async function getAuthMauStats(projectId: string): Promise<AuthMauStats> {
  const tier = (await getProjectTier(projectId)) ?? 'free';
  const ceiling = TIERS[tier].authMauPerMonth;

  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await runInProjectDatabase<CountRow[]>(projectId, async (tx) => {
    return (await tx.unsafe(
      `SELECT COUNT(DISTINCT user_id)::bigint AS count
       FROM "_briven_auth_sessions"
       WHERE created_at > now() - interval '${WINDOW_DAYS} days'`,
    )) as CountRow[];
  });

  const raw = rows[0]?.count ?? 0;
  const count = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  const usageFraction = ceiling > 0 ? Math.min(2, count / ceiling) : 0;

  return {
    count,
    ceiling,
    tier,
    windowStart: windowStart.toISOString(),
    windowEnd: now.toISOString(),
    usageFraction,
  };
}

export async function getAuthAnalyticsOverview(projectId: string): Promise<AuthAnalyticsOverview> {
  const mau = await getAuthMauStats(projectId);

  const [dauRows, signupRows, totalUsersRow, activeSessionsRow] = await runInProjectDatabase<
    [Array<{ date: string; count: number | string }>, Array<{ date: string; count: number | string }>, CountRow[], CountRow[]]
  >(projectId, async (tx) => {
    const dau = (await tx.unsafe(
      `SELECT DATE(created_at) AS date, COUNT(DISTINCT user_id)::bigint AS count
       FROM "_briven_auth_sessions"
       WHERE created_at > now() - interval '30 days'
       GROUP BY DATE(created_at)
       ORDER BY date DESC
       LIMIT 30`,
    )) as Array<{ date: string; count: number | string }>;

    const signups = (await tx.unsafe(
      `SELECT DATE(created_at) AS date, COUNT(*)::bigint AS count
       FROM "_briven_auth_users"
       WHERE created_at > now() - interval '30 days'
       GROUP BY DATE(created_at)
       ORDER BY date DESC
       LIMIT 30`,
    )) as Array<{ date: string; count: number | string }>;

    const total = (await tx.unsafe(
      `SELECT COUNT(*)::bigint AS count FROM "_briven_auth_users"`,
    )) as CountRow[];

    const sessions = (await tx.unsafe(
      `SELECT COUNT(*)::bigint AS count FROM "_briven_auth_sessions" WHERE expires_at > now()`,
    )) as CountRow[];

    return [dau, signups, total, sessions];
  });

  const parseCount = (v: number | string) => (typeof v === 'string' ? Number.parseInt(v, 10) : v);

  return {
    mau,
    dau: dauRows.map((r) => ({ date: r.date, count: parseCount(r.count) })),
    newSignups: signupRows.map((r) => ({ date: r.date, count: parseCount(r.count) })),
    totalUsers: parseCount(totalUsersRow[0]?.count ?? 0),
    activeSessions: parseCount(activeSessionsRow[0]?.count ?? 0),
  };
}

export async function getProviderBreakdown(projectId: string): Promise<ProviderBreakdown> {
  return runInProjectDatabase<ProviderBreakdown>(projectId, async (tx) => {
    const email = (await tx.unsafe(
      `SELECT COUNT(*)::bigint AS count FROM "_briven_auth_accounts" WHERE provider_id = 'credential'`,
    )) as CountRow[];
    const oauth = (await tx.unsafe(
      `SELECT COUNT(DISTINCT user_id)::bigint AS count FROM "_briven_auth_accounts" WHERE provider_id != 'credential'`,
    )) as CountRow[];
    const passkey = (await tx.unsafe(
      `SELECT COUNT(DISTINCT user_id)::bigint AS count FROM "_briven_auth_passkeys"`,
    )) as CountRow[];

    const parseCount = (v: number | string) => (typeof v === 'string' ? Number.parseInt(v, 10) : v);

    // magic-link and OTP are harder to distinguish from email; estimate from audit log.
    const magic = (await tx.unsafe(
      `SELECT COUNT(*)::bigint AS count FROM "_briven_auth_audit_log" WHERE action = 'signin' AND metadata->>'provider' = 'magic-link'`,
    )) as CountRow[];
    const otp = (await tx.unsafe(
      `SELECT COUNT(*)::bigint AS count FROM "_briven_auth_audit_log" WHERE action = 'signin' AND metadata->>'provider' = 'otp'`,
    )) as CountRow[];

    return {
      email: parseCount(email[0]?.count ?? 0),
      magicLink: parseCount(magic[0]?.count ?? 0),
      otp: parseCount(otp[0]?.count ?? 0),
      oauth: parseCount(oauth[0]?.count ?? 0),
      passkey: parseCount(passkey[0]?.count ?? 0),
    };
  });
}
