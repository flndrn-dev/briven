import type { MiddlewareHandler } from 'hono';

import { log } from '../lib/logger.js';

/**
 * Access log — one line per request. Per CLAUDE.md §5.1 we never log IPs,
 * emails, bodies, or query parameters. Path, method, status, duration, and
 * the request id are the only fields.
 */
export const accessLog = (): MiddlewareHandler => async (c, next) => {
  const start = performance.now();
  await next();
  const durationMs = Math.round((performance.now() - start) * 100) / 100;

  log.info('request', {
    reqId: c.get('requestId'),
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs,
  });
};
