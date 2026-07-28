/**
 * briven-engine abuse protection: rate limits + optional Turnstile.
 * Doltgres-backed counters when Redis is unavailable.
 */

import type { Context, MiddlewareHandler } from 'hono';

import { env } from '../../env.js';
import { getRedis } from '../../lib/redis.js';
import { verifyTurnstileToken } from '../auth-turnstile.js';
import { getEnginePool } from './db.js';
import { isAuthCoreInitialized } from './engine.js';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_HITS = 60; // per IP per window on auth FDI

function clientIp(c: Context): string {
  return (
    c.req.header('cf-connecting-ip')?.trim() ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip')?.trim() ||
    'unknown'
  );
}

async function hitDoltgres(key: string): Promise<{ allowed: boolean; count: number }> {
  if (!isAuthCoreInitialized()) return { allowed: true, count: 0 };
  const pool = getEnginePool();
  const now = new Date();
  const res = await pool.query(
    `SELECT hit_count, window_start FROM be_rate_limits WHERE bucket_key = $1 LIMIT 1`,
    [key],
  );
  const row = res.rows[0] as
    | { hit_count: number; window_start: Date | string }
    | undefined;
  if (!row) {
    await pool.query(
      `INSERT INTO be_rate_limits (bucket_key, hit_count, window_start) VALUES ($1, 1, $2)`,
      [key, now.toISOString()],
    );
    return { allowed: true, count: 1 };
  }
  const start = new Date(row.window_start).getTime();
  if (Date.now() - start > WINDOW_MS) {
    await pool.query(
      `UPDATE be_rate_limits SET hit_count = 1, window_start = $2 WHERE bucket_key = $1`,
      [key, now.toISOString()],
    );
    return { allowed: true, count: 1 };
  }
  const count = Number(row.hit_count) + 1;
  await pool.query(
    `UPDATE be_rate_limits SET hit_count = $2 WHERE bucket_key = $1`,
    [key, count],
  );
  return { allowed: count <= MAX_HITS, count };
}

async function hitRedis(key: string): Promise<{ allowed: boolean; count: number } | null> {
  const redis = getRedis();
  if (!redis) return null;
  const bucket = Math.floor(Date.now() / WINDOW_MS);
  const rk = `rl:briven-engine:${key}:${bucket}`;
  try {
    const count = await redis.incr(rk);
    if (count === 1) await redis.pexpire(rk, WINDOW_MS);
    return { allowed: count <= MAX_HITS, count };
  } catch {
    return null;
  }
}

/**
 * Rate-limit middleware for /v1/auth-core/fdi/*
 */
export function brivenEngineFdiRateLimit(): MiddlewareHandler {
  return async (c, next) => {
    if (!c.req.path.includes('/v1/auth-core/fdi')) {
      await next();
      return;
    }
    const method = c.req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      await next();
      return;
    }
    const ip = clientIp(c);
    const redisHit = await hitRedis(ip);
    const hit = redisHit ?? (await hitDoltgres(ip));
    c.header('x-briven-engine-ratelimit-limit', String(MAX_HITS));
    c.header('x-briven-engine-ratelimit-count', String(hit.count));
    if (!hit.allowed) {
      return c.json(
        {
          code: 'rate_limited',
          engine: 'briven-engine',
          message: 'Too many auth attempts. Try again later.',
        },
        429,
      );
    }
    await next();
    return;
  };
}

/**
 * Optional Turnstile on sensitive FDI mutations.
 * Body field: turnstileToken (or cf-turnstile-response).
 */
export async function requireTurnstileIfConfigured(
  body: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const secret = env.BRIVEN_TURNSTILE_SECRET_KEY;
  if (!secret) {
    // No captcha configured — allow (dev and prod until keys set)
    return { ok: true };
  }
  const token =
    (typeof body.turnstileToken === 'string' && body.turnstileToken) ||
    (typeof body['cf-turnstile-response'] === 'string' &&
      body['cf-turnstile-response']) ||
    '';
  if (!token) {
    return {
      ok: false,
      message: 'turnstileToken required',
    };
  }
  const result = await verifyTurnstileToken(token);
  if (!result.success) {
    return { ok: false, message: result.message ?? 'captcha failed' };
  }
  return { ok: true };
}

export const AUTH_CORE_ABUSE = {
  windowMs: WINDOW_MS,
  maxHits: MAX_HITS,
};
