import type { MiddlewareHandler } from 'hono';

import { newId } from '@briven/shared';

/**
 * Attach a ULID request id to every request. Forwarded downstream via the
 * `x-request-id` response header so logs, traces, and customer bug reports
 * share one key.
 */
export const requestId = (): MiddlewareHandler => async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const id = incoming && incoming.length <= 64 ? incoming : newId('ev');
  c.set('requestId', id);
  c.header('x-request-id', id);
  await next();
};
