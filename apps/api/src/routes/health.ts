import { Hono } from 'hono';

import { pingDb } from '../db/client.js';
import { pingDataPlane } from '../db/data-plane.js';
import { env } from '../env.js';
import { renderPrometheus } from '../lib/metrics.js';
import { pingRedis } from '../lib/redis.js';

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
 * /ready — dependency readiness. Returns 200 only when every required
 * upstream is reachable (control-plane postgres, data-plane postgres,
 * runtime reachable from the swarm network).
 */
healthRouter.get('/ready', async (c) => {
  const [controlOk, dataOk, runtimeOk, redisOk] = await Promise.all([
    env.BRIVEN_DATABASE_URL ? pingDb() : Promise.resolve(false),
    env.BRIVEN_DATA_PLANE_URL ? pingDataPlane() : Promise.resolve(false),
    probeRuntime(),
    env.BRIVEN_REDIS_URL ? pingRedis() : Promise.resolve(false),
  ]);

  const checks = {
    control_postgres: env.BRIVEN_DATABASE_URL
      ? controlOk
        ? 'ok'
        : 'unreachable'
      : 'not_configured',
    data_plane_postgres: env.BRIVEN_DATA_PLANE_URL
      ? dataOk
        ? 'ok'
        : 'unreachable'
      : 'not_configured',
    runtime: runtimeOk ? 'ok' : 'unreachable',
    redis: env.BRIVEN_REDIS_URL ? (redisOk ? 'ok' : 'unreachable') : 'not_configured',
  } as const;

  // Redis powers logs streaming + rate limits. Required when configured;
  // unconfigured = dev mode where logs/limits silently no-op.
  const redisRequired = !!env.BRIVEN_REDIS_URL;
  const ready = controlOk && dataOk && runtimeOk && (!redisRequired || redisOk);
  return c.json({ status: ready ? 'ready' : 'not_ready', checks }, ready ? 200 : 503);
});

/**
 * /metrics — Prometheus exposition. Intentionally unauthenticated; the
 * scraper runs on the same docker network and the host firewall is the
 * trust boundary. Per CLAUDE.md §11 every service exposes /metrics.
 */
healthRouter.get('/metrics', (c) =>
  c.text(renderPrometheus(), 200, {
    'content-type': 'text/plain; version=0.0.4; charset=utf-8',
  }),
);

async function probeRuntime(): Promise<boolean> {
  if (!env.BRIVEN_RUNTIME_URL) return false;
  try {
    const res = await fetch(`${env.BRIVEN_RUNTIME_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
