import { resolve } from 'node:path';

import { resolveBuildIdentity } from '@briven/shared';
import { Hono } from 'hono';

import { pingDb } from '../db/client.js';
import { pingDataPlane } from '../db/data-plane.js';
import { env } from '../env.js';
import { renderPrometheus } from '../lib/metrics.js';
import { pingRedis } from '../lib/redis.js';

export const BOOT_TIME = new Date().toISOString();
// apps/api runs from /app/apps/api (Dockerfile WORKDIR), so the repo
// root's .git directory is two levels up. The shared helper handles
// the env→git→"dev" fallback chain identically for every service.
const { buildSha: BUILD_SHA, buildAt: BUILD_AT } = resolveBuildIdentity(
  resolve(process.cwd(), '../../.git'),
);
export { BUILD_SHA, BUILD_AT };

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
 * /info — build + runtime metadata. Public (no auth) so:
 *   - `briven doctor` can show "running build abc1234 / booted 2h ago"
 *   - support can verify which commit a customer's deploy is on
 *   - the post-deploy CI gate can assert a fresh sha is live
 * Intentionally narrow — no secrets, no env-key listing.
 */
healthRouter.get('/info', (c) =>
  c.json({
    service: 'api',
    env: env.BRIVEN_ENV,
    buildSha: BUILD_SHA,
    buildAt: BUILD_AT,
    bootedAt: BOOT_TIME,
    uptimeSec: Math.floor(process.uptime()),
    domain: env.BRIVEN_DOMAIN ?? null,
  }),
);

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
