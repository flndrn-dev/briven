import { Hono } from 'hono';

import { auth } from '../lib/auth.js';

/**
 * Mount the Better Auth handler under /v1/auth/*.
 *
 * Better Auth owns most /v1/auth/* paths (sign-up, sign-in, sign-out, magic
 * link, OAuth callbacks, session, password reset, etc.).
 *
 * Exception: POST /v1/auth/cli-token is owned by authCliRouter and must be
 * registered *before* this catch-all (see apps/api/src/index.ts).
 */
export const authRouter = new Hono();

authRouter.on(['GET', 'POST'], '/v1/auth/*', (c) => {
  // Defence-in-depth if mount order is ever inverted.
  if (c.req.path === '/v1/auth/cli-token') {
    return c.json(
      {
        code: 'route_order_error',
        message:
          'cli-token must be handled by authCliRouter — check mount order in index.ts',
      },
      500,
    );
  }
  return auth.handler(c.req.raw);
});
