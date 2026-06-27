/**
 * Platform health summary — the single source of truth for the four
 * upstream readiness checks. Both /ready (apps/api) and the superadmin
 * Overview consume this so the two can never disagree about what
 * "healthy" means.
 *
 * `host` (CPU / RAM / disk) is null for now — those come from the
 * observability stack landing in Phase 4. We return null rather than a
 * fabricated number so the UI honestly shows "—" instead of a fake 0%.
 */
import { pingDb } from '../db/client.js';
import { pingDataPlane } from '../db/data-plane.js';
import { env } from '../env.js';
import { pingRedis } from '../lib/redis.js';

export type HealthCheck = 'ok' | 'unreachable' | 'not_configured';

export interface HealthChecks {
  control_postgres: HealthCheck;
  data_plane_postgres: HealthCheck;
  runtime: HealthCheck;
  redis: HealthCheck;
}

export interface HealthSummary {
  checks: HealthChecks;
  /** Host metrics (CPU/RAM/disk) — null until the Phase 4 observability stack. */
  host: null;
}

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

export async function getHealthSummary(): Promise<HealthSummary> {
  const [controlOk, dataOk, runtimeOk, redisOk] = await Promise.all([
    env.BRIVEN_DATABASE_URL ? pingDb() : Promise.resolve(false),
    env.BRIVEN_DATA_PLANE_URL ? pingDataPlane() : Promise.resolve(false),
    probeRuntime(),
    env.BRIVEN_REDIS_URL ? pingRedis() : Promise.resolve(false),
  ]);

  const checks: HealthChecks = {
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
  };

  return { checks, host: null };
}

/**
 * Derives the /ready boolean from the checks. Redis powers logs streaming
 * + rate limits — required only when configured; unconfigured = dev mode
 * where logs/limits silently no-op.
 */
export function isReady(checks: HealthChecks): boolean {
  return (
    checks.control_postgres === 'ok' &&
    checks.data_plane_postgres === 'ok' &&
    checks.runtime === 'ok' &&
    (checks.redis === 'ok' || checks.redis === 'not_configured')
  );
}
