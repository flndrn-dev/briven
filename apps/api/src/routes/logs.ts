import type Redis from 'ioredis';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { getRedis } from '../lib/redis.js';
import { log } from '../lib/logger.js';
import { requireProjectAuth } from '../middleware/project-auth.js';
import type { Session, User } from '../middleware/session.js';

type AppEnv = {
  Variables: {
    user: User | null;
    session: Session | null;
    apiKeyId: string | null;
    requestId: string;
  };
};

const MAX_CONCURRENT_PER_PROJECT = 10;
const HEARTBEAT_MS = 15_000;

export const logsRouter = new Hono<AppEnv>();

logsRouter.use('/v1/projects/:id/logs/*', requireProjectAuth());

/**
 * GET /v1/projects/:id/logs/stream?since=<id>&n=<N>
 *
 * Server-Sent Events stream of function invocation envelopes. Opens a
 * dedicated Redis connection per caller so XREAD BLOCK doesn't starve
 * the shared command pool. Concurrency is capped per project via a
 * counter held on the *shared* Redis to enforce the limit across
 * api replicas, not just this process.
 */
logsRouter.get('/v1/projects/:id/logs/stream', async (c) => {
  const projectId = c.req.param('id');
  const since = c.req.query('since');
  const replayN = Number(c.req.query('n') ?? 0);

  const sharedRedis = getRedis();
  if (!sharedRedis) {
    return c.json({ code: 'not_configured', message: 'redis is not configured' }, 503);
  }

  const concurrentKey = `logs:subscribers:${projectId}`;
  const current = await sharedRedis.incr(concurrentKey);
  if (current === 1) await sharedRedis.pexpire(concurrentKey, 60_000);
  if (current > MAX_CONCURRENT_PER_PROJECT) {
    await sharedRedis.decr(concurrentKey);
    return c.json(
      { code: 'too_many_subscribers', message: 'concurrent log streams exceeded' },
      429,
    );
  }

  const streamKey = `logs:${projectId}`;
  // Dedicated duplicate connection so blocking XREAD doesn't block any
  // other command on the shared ioredis pool.
  const blockingRedis = sharedRedis.duplicate();

  return streamSSE(c, async (stream) => {
    let closed = false;
    const release = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      try {
        await sharedRedis.decr(concurrentKey);
      } catch {
        // non-fatal
      }
      blockingRedis.disconnect();
    };

    stream.onAbort(() => {
      void release();
    });

    try {
      // Optional replay-before-follow window.
      let cursor = since ?? '0-0';
      if (!since && replayN > 0) {
        const tail = await readLastN(sharedRedis, streamKey, replayN);
        for (const msg of tail) {
          await stream.writeSSE({ data: JSON.stringify(msg.fields), id: msg.id });
          cursor = msg.id;
        }
      } else if (since) {
        // Range replay from `since` inclusive, up to the live head.
        const ranged = await sharedRedis.xrange(streamKey, since, '+');
        for (const [id, fields] of ranged) {
          const parsed = parseFields(fields);
          await stream.writeSSE({ data: JSON.stringify(parsed), id });
          cursor = id;
        }
      }

      // Live follow loop.
      while (!closed) {
        const reply = (await blockingRedis.xread(
          'BLOCK',
          HEARTBEAT_MS,
          'STREAMS',
          streamKey,
          cursor,
        )) as Array<[string, Array<[string, string[]]>]> | null;

        if (!reply) {
          // Heartbeat so proxies don't sever the connection.
          await stream.writeSSE({ event: 'ping', data: '' });
          continue;
        }
        for (const [, entries] of reply) {
          for (const [id, fields] of entries) {
            const parsed = parseFields(fields);
            await stream.writeSSE({ data: JSON.stringify(parsed), id });
            cursor = id;
          }
        }
      }
    } catch (err) {
      log.warn('logs_stream_error', {
        projectId,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      await release();
    }
  });
});

interface ParsedMessage {
  id: string;
  fields: Record<string, string>;
}

async function readLastN(redis: Redis, key: string, n: number): Promise<ParsedMessage[]> {
  const rev = await redis.xrevrange(key, '+', '-', 'COUNT', n);
  return rev.map(([id, fields]) => ({ id, fields: parseFields(fields) })).reverse();
}

function parseFields(flat: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < flat.length; i += 2) {
    const k = flat[i];
    const v = flat[i + 1];
    if (typeof k === 'string' && typeof v === 'string') out[k] = v;
  }
  return out;
}
