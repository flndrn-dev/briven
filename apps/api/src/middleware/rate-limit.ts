import { RateLimitedError } from '@briven/shared';
import type { MiddlewareHandler } from 'hono';

import { getRedis } from '../lib/redis.js';

/**
 * Sliding-window rate limiter backed by Redis. Fails open (allows the
 * request) if Redis is unavailable — preferable for Phase 3 dogfood to
 * hard-failing every request on a transient outage.
 *
 * Key layout: `rl:<scope>:<subject>:<bucket>` where bucket is
 * `floor(now / windowMs)`. An adjacent bucket lookup gives us a sliding
 * window by weighting the prior bucket's count by how far into the
 * current window we are.
 */
export interface RateLimitOptions {
  scope: string; // e.g. 'auth', 'invoke', 'deploy'
  limit: number; // max requests per window
  windowMs: number; // window size in ms
  /** Returns the identifier to rate-limit on (ip/project/user). */
  key: (c: Parameters<MiddlewareHandler>[0]) => string | null;
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const subject = options.key(c);
    const redis = getRedis();
    if (!subject || !redis) {
      await next();
      return;
    }

    const now = Date.now();
    const bucket = Math.floor(now / options.windowMs);
    const currentKey = `rl:${options.scope}:${subject}:${bucket}`;
    const prevKey = `rl:${options.scope}:${subject}:${bucket - 1}`;

    try {
      const [currentRaw, prevRaw] = await Promise.all([redis.incr(currentKey), redis.get(prevKey)]);
      if (currentRaw === 1) {
        // Expire after 2 windows so the prev lookup still works.
        await redis.pexpire(currentKey, options.windowMs * 2);
      }

      const prev = Number(prevRaw) || 0;
      const progress = (now % options.windowMs) / options.windowMs;
      const weighted = prev * (1 - progress) + currentRaw;

      if (weighted > options.limit) {
        const retryAfterSec = Math.ceil((options.windowMs - (now % options.windowMs)) / 1000);
        c.header('Retry-After', String(retryAfterSec));
        c.header('X-RateLimit-Limit', String(options.limit));
        c.header('X-RateLimit-Remaining', '0');
        throw new RateLimitedError(retryAfterSec);
      }

      c.header('X-RateLimit-Limit', String(options.limit));
      c.header('X-RateLimit-Remaining', String(Math.max(0, options.limit - Math.ceil(weighted))));
    } catch (err) {
      if (err instanceof RateLimitedError) throw err;
      // Redis down → fail open (logged in lib/redis.ts already).
    }

    await next();
  };
}

/** Pull `x-forwarded-for` first address; fall back to a stable label. */
export function ipKey(c: Parameters<MiddlewareHandler>[0]): string | null {
  const fwd = c.req.raw.headers.get('x-forwarded-for');
  if (!fwd) return null;
  return fwd.split(',')[0]!.trim();
}
