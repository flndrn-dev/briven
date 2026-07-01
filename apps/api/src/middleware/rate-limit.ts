import { RateLimitedError } from '@briven/shared';
import type { MiddlewareHandler } from 'hono';

import { env } from '../env.js';
import { getRedis } from '../lib/redis.js';
import {
  RATE_LIMIT_WINDOW_MS,
  resolveProjectRateLimit,
  type RateLimitScope,
} from '../services/tiers.js';

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
  /**
   * Max requests per window. Pass a number for a static cap, or a function
   * to compute the cap per-request — used by tier-aware limits where the
   * cap depends on the project's subscription tier resolved at request
   * time. Returning `null` from the function skips the limit (e.g. when
   * the project isn't found and we'd rather pass through than DDoS-amplify
   * the lookup).
   */
  limit:
    | number
    | ((c: Parameters<MiddlewareHandler>[0]) => Promise<number | null> | number | null);
  windowMs: number; // window size in ms
  /** Returns the identifier to rate-limit on (ip/project/user). */
  key: (c: Parameters<MiddlewareHandler>[0]) => string | null;
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    // why: outside dev, requests must arrive via the edge proxy, which
    // stamps the real client IP. Historically that was Cloudflare's
    // `cf-connecting-ip`; this deployment now runs its own DNS straight to
    // Traefik, which sets the standard `x-forwarded-for` instead. Accept
    // either — a request carrying NEITHER is hitting the origin directly
    // (bypassing the proxy to dodge IP-based limits), so reject it before
    // any work. Project-keyed limits don't depend on this header; IP-keyed
    // ones fall back to x-forwarded-for's first hop via `ipKey`.
    if (env.BRIVEN_ENV !== 'development') {
      const cf = c.req.raw.headers.get('cf-connecting-ip');
      const fwd = c.req.raw.headers.get('x-forwarded-for');
      if ((!cf || !cf.trim()) && (!fwd || !fwd.trim())) {
        return c.json({ code: 'origin_direct_rejected' }, 403);
      }
    }

    const subject = options.key(c);
    const redis = getRedis();
    if (!subject || !redis) {
      await next();
      return;
    }

    // Resolve the dynamic cap. A null return means "skip rate limiting"
    // (e.g. project not found — pass through rather than amplify the
    // lookup into a DoS vector).
    const limit =
      typeof options.limit === 'function' ? await options.limit(c) : options.limit;
    if (limit === null) {
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

      if (weighted > limit) {
        const retryAfterSec = Math.ceil((options.windowMs - (now % options.windowMs)) / 1000);
        c.header('Retry-After', String(retryAfterSec));
        c.header('X-RateLimit-Limit', String(limit));
        c.header('X-RateLimit-Remaining', '0');
        throw new RateLimitedError(retryAfterSec);
      }

      c.header('X-RateLimit-Limit', String(limit));
      c.header('X-RateLimit-Remaining', String(Math.max(0, limit - Math.ceil(weighted))));
    } catch (err) {
      if (err instanceof RateLimitedError) throw err;
      // Redis down → fail open (logged in lib/redis.ts already).
    }

    await next();
    return;
  };
}

/**
 * Resolve the client IP for rate-limit keying. Prefers `cf-connecting-ip`
 * (set by Cloudflare when fronted by it; not spoofable by clients), then
 * falls back to `x-forwarded-for`'s first hop — which is what Traefik sets
 * in the current self-hosted (no-Cloudflare) deployment, and what local
 * tunnels / docker proxies set in development. Returns null when neither
 * is present (the rateLimit middleware then skips IP keying rather than
 * bucketing every anonymous request together).
 */
export function ipKey(c: Parameters<MiddlewareHandler>[0]): string | null {
  const cf = c.req.raw.headers.get('cf-connecting-ip');
  if (cf) {
    const trimmed = cf.trim();
    if (trimmed.length > 0) return trimmed;
  }
  const fwd = c.req.raw.headers.get('x-forwarded-for');
  if (!fwd) return null;
  return fwd.split(',')[0]!.trim();
}

/**
 * Tier-aware rate limit keyed by `:id` (project) for a given scope. The
 * cap is resolved per-request from the project's denormalised tier, with
 * `null` (skip rate limiting) returned when the project doesn't exist —
 * the auth middleware downstream returns 404 either way, but skipping
 * here avoids amplifying an unknown-project lookup into a DoS vector.
 */
export function projectRateLimit(scope: RateLimitScope): MiddlewareHandler {
  return rateLimit({
    scope,
    limit: (c) => {
      const id = c.req.param('id');
      return id ? resolveProjectRateLimit(id, scope) : null;
    },
    windowMs: RATE_LIMIT_WINDOW_MS,
    key: (c) => c.req.param('id') ?? null,
  });
}

/**
 * Flat-cap rate limit keyed by the authenticated user id. Used for routes
 * that aren't project-scoped (billing checkout/portal, org member
 * mutations) — there's no project tier to read, so a single fixed cap
 * applies per user. Unauthenticated requests skip the limit; downstream
 * auth middleware returns 401 either way.
 *
 * Phase 3 §3.7: covers the mutate routes that fell outside `projectRateLimit`.
 */
export function userRateLimit(scope: string, cap: number): MiddlewareHandler {
  return rateLimit({
    scope,
    limit: cap,
    windowMs: RATE_LIMIT_WINDOW_MS,
    key: (c) => {
      const user = c.get('user') as { id?: string } | undefined;
      return user?.id ?? null;
    },
  });
}
