import { Hono } from 'hono';

import { pingDb } from '../db/client.js';
import { pingDataPlane } from '../db/data-plane.js';
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
 * /ready — dependency readiness. Returns 200 only when every required
 * upstream is reachable (control-plane postgres, data-plane postgres,
 * runtime reachable from the swarm network).
 */
healthRouter.get('/ready', async (c) => {
  const [controlOk, dataOk, runtimeOk] = await Promise.all([
    env.BRIVEN_DATABASE_URL ? pingDb() : Promise.resolve(false),
    env.BRIVEN_DATA_PLANE_URL ? pingDataPlane() : Promise.resolve(false),
    probeRuntime(),
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
  } as const;

  const ready = controlOk && dataOk && runtimeOk;
  return c.json({ status: ready ? 'ready' : 'not_ready', checks }, ready ? 200 : 503);
});

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
