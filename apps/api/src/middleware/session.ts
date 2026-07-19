import type { MiddlewareHandler } from 'hono';

import { auth, type Session, type User } from '../lib/auth.js';
import { log } from '../lib/logger.js';

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
  // If an upstream project-scoped guard (requireProjectAuth) already
  // authenticated this request via a project API key (Bearer brk_…), accept
  // it: the key is not a CLI JWT and the Bearer check below would otherwise
  // reject it as "invalid cli token". Sessions and CLI JWTs still verify
  // through the logic that follows. This is what lets `briven deploy` /
  // SDK calls (which carry brk_ keys) reach project routes that sit behind
  // both this broad guard and a route-level requireProjectAuth.
  if (c.get('apiKeyId')) {
    await next();
    return;
  }

  // SCIM 2.0 directory-sync (enterprise): protocol lives on
  // `/v1/projects/:id/scim/v2/*` and authenticates with `scim_briven_…`
  // bearer tokens only — not dashboard sessions or CLI JWTs. The broad
  // `/v1/projects/*` requireAuth on projectsRouter must NOT reject those
  // requests; auth-scim router enforces the token itself.
  const path = c.req.path;
  if (path.includes('/scim/v2')) {
    await next();
    return;
  }

  const authHeader = c.req.header('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    // SCIM tokens are never CLI JWTs — pass through even off /scim paths
    // (defensive; primary carve-out is path-based above).
    if (token.startsWith('scim_briven_')) {
      await next();
      return;
    }
    try {
      const { verifyCliToken } = await import('../lib/cli-jwt.js');
      const payload = await verifyCliToken(token);
      const { getDb } = await import('../db/client.js');
      const { users: userTable } = await import('../db/schema.js');
      const { eq } = await import('drizzle-orm');
      const [row] = await getDb()
        .select({ id: userTable.id, email: userTable.email, name: userTable.name })
        .from(userTable)
        .where(eq(userTable.id, payload.sub))
        .limit(1);
      if (!row) {
        return c.json({ code: 'unauthorized', message: 'cli token user not found' }, 401);
      }
      c.set('user', row as unknown as User);
      await next();
      return;
    } catch (err) {
      log.warn('cli_bearer_rejected', {
        err: err instanceof Error ? err.message : String(err),
      });
      return c.json({ code: 'unauthorized', message: 'invalid cli token' }, 401);
    }
  }

  const user = c.get('user') as User | null;
  if (!user) {
    return c.json({ code: 'unauthorized', message: 'authentication required' }, 401);
  }
  await next();
  return;
};

export type { Session, User };
