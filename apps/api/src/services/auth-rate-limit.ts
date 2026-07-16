import { createHash } from 'node:crypto';

import { log } from '../lib/logger.js';

/**
 * In-memory sliding-window rate limiter for briven auth endpoints.
 *
 * Uses a per-key counter map with automatic expiry. Redis-backed
 * upgrade is planned (Phase 2+) when `BRIVEN_REDIS_URL` is set;
 * for now the in-memory store is sufficient for a single API process
 * and degrades gracefully under horizontal scale (each process has
 * its own counter, so the effective limit is `n_processes * configured_limit`).
 *
 * Keys:
 *   - `ip:<projectId>:<ip>`      → per-IP per-project
 *   - `email:<projectId>:<email>` → per-email per-project
 *
 * Window: fixed sliding window in minutes. A counter is valid from
 * `bucketStart` to `bucketStart + windowMs`; once the window slides
 * past, the counter resets.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

/** Background cleanup every 60s to prevent unbounded memory growth. */
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, bucket] of store.entries()) {
    if (bucket.resetAt <= now) {
      store.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    log.debug('rate_limiter_cleanup', { cleaned, remaining: store.size });
  }
}, 60_000);

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function makeBucketKey(type: 'ip' | 'email', projectId: string, identifier: string): string {
  return `${type}:${projectId}:${hashKey(identifier)}`;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

/**
 * Check whether an action is within the rate limit. If allowed, increments
 * the counter atomically. If denied, the counter is NOT incremented.
 */
export function checkRateLimit(
  type: 'ip' | 'email',
  projectId: string,
  identifier: string,
  opts: { maxAttempts: number; windowMinutes: number },
): RateLimitResult {
  const key = makeBucketKey(type, projectId, identifier);
  const now = Date.now();
  const windowMs = opts.windowMinutes * 60_000;

  let bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
  }

  if (bucket.count >= opts.maxAttempts) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return {
      allowed: false,
      limit: opts.maxAttempts,
      remaining: 0,
      resetAt: bucket.resetAt,
      retryAfterSeconds: retryAfter,
    };
  }

  bucket.count++;
  store.set(key, bucket);

  return {
    allowed: true,
    limit: opts.maxAttempts,
    remaining: opts.maxAttempts - bucket.count,
    resetAt: bucket.resetAt,
    retryAfterSeconds: 0,
  };
}

/**
 * Convenience: check rate limit for an IP address.
 */
export function checkIpRateLimit(
  projectId: string,
  ip: string,
  opts: { maxAttempts: number; windowMinutes: number },
): RateLimitResult {
  return checkRateLimit('ip', projectId, ip, opts);
}

/**
 * Convenience: check rate limit for an email address.
 */
export function checkEmailRateLimit(
  projectId: string,
  email: string,
  opts: { maxAttempts: number; windowMinutes: number },
): RateLimitResult {
  return checkRateLimit('email', projectId, email.toLowerCase().trim(), opts);
}

/**
 * Reset a rate-limit bucket. Useful for admin unblocking or testing.
 */
export function resetRateLimit(
  type: 'ip' | 'email',
  projectId: string,
  identifier: string,
): void {
  const key = makeBucketKey(type, projectId, identifier);
  store.delete(key);
}
