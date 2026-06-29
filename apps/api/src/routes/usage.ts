import { Hono } from 'hono';

import { requireProjectAuth } from '../middleware/project-auth.js';
import { fetchProjectRealtimeStats } from '../services/realtime-stats.js';
import {
  getConnectionSecondsUsage,
  getCurrentMonthAuthMau,
  getCurrentMonthConnectionSecondsUsage,
  getCurrentMonthInvocationUsage,
  getInvocationUsage,
  getStorageUsage,
} from '../services/usage.js';
import { getProjectTier, TIERS } from '../services/tiers.js';
import type { ProjectAppEnv as AppEnv } from '../types/app-env.js';

export const usageRouter = new Hono<AppEnv>();

usageRouter.use('/v1/projects/:id/usage', requireProjectAuth());
usageRouter.use('/v1/projects/:id/realtime-stats', requireProjectAuth());

/**
 * Current-period usage for a project. Default period = current calendar
 * month UTC. Pass `?from=…&until=…` (ISO 8601) to query a custom
 * window — useful for billing reconciliation or historical lookups,
 * subject to function_logs retention (free tier: 7 days).
 *
 * Phase 3 follow-ups (deferred):
 * - DB-size / storage-bytes / RT-connection-minutes signals
 * - usage_rollups table for periods beyond log retention
 * - Polar metering API push
 */
usageRouter.get('/v1/projects/:id/usage', async (c) => {
  const projectId = c.req.param('id');
  const fromParam = c.req.query('from');
  const untilParam = c.req.query('until');

  let invocations;
  let connection;
  let periodStart: string;
  let periodEnd: string;
  // auth MAU is a monthly gauge — read the durable usage_events row for the
  // month the requested window falls in (the `from` month for a custom
  // range, else the current month). Reference instant computed below.
  let mauRef = new Date();
  if (fromParam || untilParam) {
    if (!fromParam || !untilParam) {
      return c.json(
        { code: 'validation_failed', message: 'from and until must be provided together' },
        400,
      );
    }
    const from = new Date(fromParam);
    const until = new Date(untilParam);
    if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime())) {
      return c.json(
        { code: 'validation_failed', message: 'from and until must be ISO 8601 timestamps' },
        400,
      );
    }
    if (until <= from) {
      return c.json(
        { code: 'validation_failed', message: 'until must be after from' },
        400,
      );
    }
    invocations = await getInvocationUsage(projectId, from, until);
    connection = await getConnectionSecondsUsage(projectId, from, until);
    periodStart = from.toISOString();
    periodEnd = until.toISOString();
    mauRef = from;
  } else {
    invocations = await getCurrentMonthInvocationUsage(projectId);
    connection = await getCurrentMonthConnectionSecondsUsage(projectId);
    periodStart = invocations.periodStart;
    periodEnd = invocations.periodEnd;
  }

  // Surface the project's tier + monthly cap alongside the raw count so
  // the dashboard widget needs only one round-trip. Soft cap — over-cap
  // doesn't block invokes today; rate-limit middleware enforces the
  // per-request floor (services/tiers.ts: RATE_LIMITS_BY_TIER).
  const tier = (await getProjectTier(projectId)) ?? 'free';
  const limits = TIERS[tier];

  // Storage is sampled live (single round-trip to the data plane) — at
  // 25-customer scale the cost is negligible. If it ever becomes a hot
  // path the natural cache is a `usage_rollups` snapshot updated every
  // 5 min by the same cron that will push to Polar metering.
  const storage = await getStorageUsage(projectId);

  // Auth MAU from the durable monthly roll-up (the exact value billed to
  // Polar), so the primary usage widget can show it without a live
  // tenant-DB distinct-count. 0 when auth is off / no row yet.
  const authMauCount = await getCurrentMonthAuthMau(projectId, mauRef);

  return c.json({
    projectId,
    periodStart,
    periodEnd,
    tier,
    invocations: {
      count: invocations.count,
      totalDurationMs: invocations.totalDurationMs,
    },
    storage: {
      bytes: storage.bytes,
      tableCount: storage.tableCount,
      sampledAt: storage.sampledAt,
    },
    connection: {
      seconds: connection.seconds,
    },
    authMau: {
      count: authMauCount,
    },
    limits: {
      invokesPerMonth: limits.invokesPerMonth,
      storageBytes: limits.storageBytes,
      connectionSecondsPerMonth: limits.connectionSecondsPerMonth,
      concurrentSubscriptions: limits.concurrentSubscriptions,
      authMauPerMonth: limits.authMauPerMonth,
    },
  });
});

/**
 * Live realtime usage for the requested project — scoped to the caller's
 * own project so a non-admin owner can see their own concurrent-sub
 * count vs cap without enumerating other projects. Returns 503 when the
 * realtime service is unconfigured/unreachable; the dashboard treats that
 * as "—" rather than rendering a stale or zeroed banner.
 */
usageRouter.get('/v1/projects/:id/realtime-stats', async (c) => {
  const projectId = c.req.param('id');
  const stats = await fetchProjectRealtimeStats(projectId);
  if (!stats) return c.json({ code: 'realtime_unavailable' }, 503);
  return c.json({ projectId, ...stats });
});
