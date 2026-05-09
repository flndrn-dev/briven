import Redis from 'ioredis';

import { env } from '../env.js';
import { log } from './logger.js';

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
      log.warn('redis_error', { message: err.message });
    });
  }
  return _redis;
}

export async function pingRedis(): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try {
    const reply = await r.ping();
    return reply === 'PONG';
  } catch {
    return false;
  }
}
