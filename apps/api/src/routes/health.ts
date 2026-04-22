import { Hono } from 'hono';

import { pingDb } from '../db/client.js';
import { env } from '../env.js';

const BOOT_TIME = new Date().toISOString();

export const healthRouter = new Hono();

/**
 * /health — process liveness. Never depends on anything external.
 * Per CLAUDE.md §5.5: health = process alive, ready = deps reachable.
 */
healthRouter.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'api',
    env: env.BRIVEN_ENV,
    bootedAt: BOOT_TIME,
  }),
);

/**
 * /ready — dependency readiness. Fails if any required dep is unreachable.
 * Postgres probe is live; Redis probe lands when sessions/queues are wired.
 */
healthRouter.get('/ready', async (c) => {
  const dbConfigured = Boolean(env.BRIVEN_DATABASE_URL);
  const redisConfigured = Boolean(env.BRIVEN_REDIS_URL);

  const dbOk = dbConfigured ? await pingDb() : false;

  const checks = {
    postgres: !dbConfigured ? 'not_configured' : dbOk ? 'ok' : 'unreachable',
    redis: redisConfigured ? 'pending_probe' : 'not_configured',
  } as const;

  const ready = dbOk && redisConfigured;
  return c.json({ status: ready ? 'ready' : 'not_ready', checks }, ready ? 200 : 503);
});
