import type { Context, ErrorHandler } from 'hono';

import { brivenError } from '@briven/shared';

import { log } from '../lib/logger.js';

/**
 * Global error handler. Customer-facing responses carry only `{ code, message }`
 * — never stack traces, paths, or internal context. Full error is logged
 * server-side keyed by request id.
 */
export const errorHandler: ErrorHandler = (err: Error, c: Context): Response => {
  const reqId = c.get('requestId');

  if (err instanceof brivenError) {
    log.warn('handled_error', {
      reqId,
      code: err.code,
      status: err.status,
      message: err.message,
    });
    return c.json({ code: err.code, message: err.message }, err.status as never);
  }

  log.error('unhandled_error', {
    reqId,
    name: err.name,
    message: err.message,
  });
  return c.json({ code: 'internal_error', message: 'internal error' }, 500);
};
