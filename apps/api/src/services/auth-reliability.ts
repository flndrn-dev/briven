/**
 * S6 — Auth reliability signals (in-process + Prometheus).
 *
 * Lightweight counters so operators can see rate-limit pressure, mailer
 * failures, and Redis fallback without waiting for a full APM stack.
 * Exposed via:
 *   - GET /v1/admin/auth-reliability  (admin dashboard)
 *   - GET /metrics  (Prometheus: briven_auth_* counters)
 *   - getAuthReliabilitySnapshot() embedded in admin health notes
 */

import { incCounter } from '../lib/metrics.js';
import { env } from '../env.js';
import { pingRedis } from '../lib/redis.js';

const startedAt = new Date().toISOString();

const counters = {
  rateLimitDenied: 0,
  rateLimitMemoryFallback: 0,
  mailerFailures: 0,
  authRoute5xx: 0,
};

export type AuthReliabilityBackend = 'redis' | 'memory';

export function recordAuthRateLimitDenied(backend: AuthReliabilityBackend): void {
  counters.rateLimitDenied += 1;
  incCounter('briven_auth_rate_limit_denied_total', { backend });
}

export function recordAuthRateLimitMemoryFallback(): void {
  counters.rateLimitMemoryFallback += 1;
  incCounter('briven_auth_rate_limit_memory_fallback_total', { reason: 'no_redis' });
}

export function recordAuthMailerFailure(kind: string): void {
  counters.mailerFailures += 1;
  incCounter('briven_auth_mailer_failures_total', { kind: kind.slice(0, 48) });
}

export function recordAuthRoute5xx(): void {
  counters.authRoute5xx += 1;
  incCounter('briven_auth_route_5xx_total', {});
}

/** Test helper — resets process-local counters only (not Prometheus registry). */
export function resetAuthReliabilityCountersForTests(): void {
  counters.rateLimitDenied = 0;
  counters.rateLimitMemoryFallback = 0;
  counters.mailerFailures = 0;
  counters.authRoute5xx = 0;
}

export interface AuthReliabilitySnapshot {
  startedAt: string;
  uptimeSec: number;
  redisConfigured: boolean;
  redisOk: boolean | null;
  counters: {
    rateLimitDenied: number;
    rateLimitMemoryFallback: number;
    mailerFailures: number;
    authRoute5xx: number;
  };
  /** Operator-facing guidance (S6.3). */
  watch: readonly string[];
  isolation: {
    claim: string;
    proveInDashboard: string;
    unitTests: string;
  };
}

export async function getAuthReliabilitySnapshot(): Promise<AuthReliabilitySnapshot> {
  const redisConfigured = Boolean(env.BRIVEN_REDIS_URL);
  let redisOk: boolean | null = null;
  if (redisConfigured) {
    redisOk = await pingRedis();
  }

  return {
    startedAt,
    uptimeSec: Math.floor(process.uptime()),
    redisConfigured,
    redisOk,
    counters: { ...counters },
    watch: [
      'GET /ready → checks.redis must be ok when BRIVEN_REDIS_URL is set',
      'briven_auth_rate_limit_denied_total rising under attack = limits working',
      'briven_auth_rate_limit_memory_fallback_total rising = Redis missing; limits per-process only',
      'briven_auth_mailer_failures_total rising = magic-link / recovery mail broken',
      'briven_auth_route_5xx_total rising = auth path internal errors',
    ],
    isolation: {
      claim:
        'Auth users, sessions, and pk_briven_auth_* keys are scoped per project. Cross-project reads must 401/403/404.',
      proveInDashboard:
        'Create two projects, enable Auth on both, sign up on A, confirm A user is absent from B Auth → Users.',
      unitTests: 'bun test src/services/auth-tenant-isolation.test.ts src/services/auth-rate-limit.test.ts',
    },
  };
}
