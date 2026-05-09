import type { MiddlewareHandler } from 'hono';

import { auth, type Session, type User } from '../lib/auth.js';

/**
 * Populate every request context with the current user + session, or nulls.
 * Protected routes then use `requireAuth()` below.
 */
export const attachSession = (): MiddlewareHandler => async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session) {
    c.set('user', session.user);
    c.set('session', session.session);
  } else {
    c.set('user', null);
    c.set('session', null);
  }
  await next();
};

/**
 * Guard for any route that must not run anonymously. Returns 401 with a
 * structured error so the CLI/dashboard can redirect to sign-in.
 */
export const requireAuth = (): MiddlewareHandler => async (c, next) => {
  const user = c.get('user') as User | null;
  if (!user) {
    return c.json({ code: 'unauthorized', message: 'authentication required' }, 401);
  }
  await next();
  return;
};

export type { Session, User };
