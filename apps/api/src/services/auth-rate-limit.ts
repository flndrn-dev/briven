import { createHash } from 'node:crypto';

import { Redis } from 'ioredis';

import { log } from '../lib/logger.js';
import { env } from '../env.js';

/**
 * Rate limiter for briven auth endpoints.
 *
 * Uses Redis when `BRIVEN_REDIS_URL` is configured; falls back to an
 * in-memory per-key counter map with automatic expiry. Under horizontal
 * scale the Redis store shares counters across processes, while the
 * in-memory store is process-local (effective limit = n_processes * limit).
 *
 * Keys:
 *   - `ip:<projectId>:<ip>`      → per-IP per-project
 *   - `email:<projectId>:<email>` → per-email per-project
 *
 * Window: fixed sliding window in minutes. A counter is valid from
 * creation until `windowMs` later; once the window slides past,
 * the counter resets (Redis TTL or in-memory expiry).
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

function redisKey(type: 'ip' | 'email', projectId: string, identifier: string): string {
  return `briven:rl:${type}:${projectId}:${hashKey(identifier)}`;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

// ─── Redis backing (lazy initialisation) ───────────────────────────────────

let redisClient: Redis | null = null;

function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  if (!env.BRIVEN_REDIS_URL) return null;
  try {
    redisClient = new Redis(env.BRIVEN_REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    redisClient.on('error', (err: Error) => {
      log.warn('rate_limiter_redis_error', { message: err.message });
    });
    return redisClient;
  } catch {
    return null;
  }
}

async function checkRedisRateLimit(
  key: string,
  opts: { maxAttempts: number; windowMinutes: number },
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (!redis) {
    // Should never happen (caller guards), but fail-open.
    return { allowed: true, limit: opts.maxAttempts, remaining: opts.maxAttempts, resetAt: Date.now(), retryAfterSeconds: 0 };
  }

  const windowSeconds = opts.windowMinutes * 60;
  const now = Date.now();

  // Atomically increment; if the key was just created, set TTL.
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }

  const ttl = await redis.ttl(key);
  const resetAt = now + Math.max(ttl, 0) * 1000;

  if (count > opts.maxAttempts) {
    const retryAfter = Math.max(ttl, 0);
    return {
      allowed: false,
      limit: opts.maxAttempts,
      remaining: 0,
      resetAt,
      retryAfterSeconds: retryAfter,
    };
  }

  return {
    allowed: true,
    limit: opts.maxAttempts,
    remaining: opts.maxAttempts - count,
    resetAt,
    retryAfterSeconds: 0,
  };
}

async function resetRedisRateLimit(key: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.del(key);
  }
}

// ─── In-memory backing ─────────────────────────────────────────────────────

function checkMemoryRateLimit(
  key: string,
  opts: { maxAttempts: number; windowMinutes: number },
): RateLimitResult {
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

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Check whether an action is within the rate limit. If allowed, increments
 * the counter atomically. If denied, the counter is NOT incremented.
 */
export async function checkRateLimit(
  type: 'ip' | 'email',
  projectId: string,
  identifier: string,
  opts: { maxAttempts: number; windowMinutes: number },
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (redis) {
    return checkRedisRateLimit(redisKey(type, projectId, identifier), opts);
  }
  return checkMemoryRateLimit(makeBucketKey(type, projectId, identifier), opts);
}

/**
 * Convenience: check rate limit for an IP address.
 */
export async function checkIpRateLimit(
  projectId: string,
  ip: string,
  opts: { maxAttempts: number; windowMinutes: number },
): Promise<RateLimitResult> {
  return checkRateLimit('ip', projectId, ip, opts);
}

/**
 * Convenience: check rate limit for an email address.
 */
export async function checkEmailRateLimit(
  projectId: string,
  email: string,
  opts: { maxAttempts: number; windowMinutes: number },
): Promise<RateLimitResult> {
  return checkRateLimit('email', projectId, email.toLowerCase().trim(), opts);
}

/**
 * Reset a rate-limit bucket. Useful for admin unblocking or testing.
 */
export async function resetRateLimit(
  type: 'ip' | 'email',
  projectId: string,
  identifier: string,
): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await resetRedisRateLimit(redisKey(type, projectId, identifier));
  }
  store.delete(makeBucketKey(type, projectId, identifier));
}
