import Redis from 'ioredis';

import { env } from '../env.js';

/**
 * Lazy ioredis singleton. Mirrors apps/api/src/lib/redis.ts so behaviour is
 * consistent across services. Returns null when the URL isn't set — every
 * caller must gracefully skip in that case.
 */
let _redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (!env.BRIVEN_REDIS_URL) return null;
  if (!_redis) {
    _redis = new Redis(env.BRIVEN_REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    _redis.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.warn('[runtime] redis error:', err.message);
    });
  }
  return _redis;
}
