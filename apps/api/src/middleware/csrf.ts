import type { MiddlewareHandler } from 'hono';

import { env } from '../env.js';
import { log } from '../lib/logger.js';
import type { Session } from './session.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Pure policy function — extracted so the middleware decision is unit-testable
 * without spinning up a full Hono context.
 *
 * Defence-in-depth on top of `sameSite: 'strict'` for the session cookie.
 * For unsafe methods on cookie-authenticated routes, require the `Origin`
 * header to match a trusted origin. API-key authenticated requests carry
 * no session cookie and so bypass. Webhook endpoints (Polar, etc.) are
 * never session-authenticated, so they bypass too.
 *
 * Better Auth's own /v1/auth/* routes handle their internal CSRF separately;
 * we skip those to avoid double-counting.
 */
export function shouldRejectAsCsrf(input: {
  method: string;
  hasSession: boolean;
  path: string;
  origin: string | null;
  trustedOrigins: readonly string[];
}): boolean {
  if (!UNSAFE_METHODS.has(input.method.toUpperCase())) return false;
  if (!input.hasSession) return false;
  if (input.path.startsWith('/v1/auth/')) return false;
  if (!input.origin || !input.trustedOrigins.includes(input.origin)) return true;
  return false;
}

function trustedOrigins(): string[] {
  const list = new Set<string>([env.BRIVEN_API_ORIGIN, env.BRIVEN_WEB_ORIGIN]);
  for (const o of env.BRIVEN_TRUSTED_ORIGINS.split(',').map((s) => s.trim())) {
    if (o) list.add(o);
  }
  return [...list];
}

export const csrfOriginCheck = (): MiddlewareHandler => async (c, next) => {
  const session = c.get('session') as Session | null | undefined;
  const path = new URL(c.req.url).pathname;
  const origin = c.req.header('origin') ?? null;

  if (
    shouldRejectAsCsrf({
      method: c.req.method,
      hasSession: Boolean(session),
      path,
      origin,
      trustedOrigins: trustedOrigins(),
    })
  ) {
    log.warn('csrf_origin_rejected', { path, method: c.req.method, origin });
    return c.json(
      { code: 'csrf_origin_rejected', message: 'request origin is not trusted' },
      403,
    );
  }

  await next();
  return;
};
