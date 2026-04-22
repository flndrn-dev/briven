import { Hono } from 'hono';

import { auth } from '../lib/auth.js';

/**
 * Mount the Better Auth handler under /v1/auth/*.
 *
 * Better Auth owns every /v1/auth/* path (sign-up, sign-in, sign-out, magic
 * link, OAuth callbacks, session, password reset, etc.). We never add our
 * own routes inside this tree.
 */
export const authRouter = new Hono();

authRouter.on(['GET', 'POST'], '/v1/auth/*', (c) => auth.handler(c.req.raw));
