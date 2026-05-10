import { Hono } from 'hono';

import { requireProjectAuth } from '../middleware/project-auth.js';
import {
  getCurrentMonthInvocationUsage,
  getInvocationUsage,
} from '../services/usage.js';
import { getProjectTier, TIERS } from '../services/tiers.js';
import type { ProjectAppEnv as AppEnv } from '../types/app-env.js';

export const usageRouter = new Hono<AppEnv>();

usageRouter.use('/v1/projects/:id/usage', requireProjectAuth());

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
  let periodStart: string;
  let periodEnd: string;
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
    periodStart = from.toISOString();
    periodEnd = until.toISOString();
  } else {
    invocations = await getCurrentMonthInvocationUsage(projectId);
    periodStart = invocations.periodStart;
    periodEnd = invocations.periodEnd;
  }

  // Surface the project's tier + monthly cap alongside the raw count so
  // the dashboard widget needs only one round-trip. Soft cap — over-cap
  // doesn't block invokes today; rate-limit middleware enforces the
  // per-request floor (services/tiers.ts: RATE_LIMITS_BY_TIER).
  const tier = (await getProjectTier(projectId)) ?? 'free';
  const monthlyCap = TIERS[tier].invokesPerMonth;

  return c.json({
    projectId,
    periodStart,
    periodEnd,
    tier,
    invocations: {
      count: invocations.count,
      totalDurationMs: invocations.totalDurationMs,
    },
    limits: {
      invokesPerMonth: monthlyCap,
    },
  });
});
