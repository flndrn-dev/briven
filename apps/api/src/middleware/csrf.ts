import type { MiddlewareHandler } from 'hono';

import { env } from '../env.js';
import { log } from '../lib/logger.js';
import {
  brivenOwnOrigins,
  isRegisteredOrigin,
} from '../services/auth-origin-allowlist.js';
import type { Session } from './session.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Explicit allowlist of /v1/auth/* paths owned by Better Auth (core + the
 * plugins we mount in apps/api/src/lib/auth.ts: magic-link + genericOAuth).
 * Better Auth carries its own internal CSRF for these, so the origin-check
 * carve-out is justified.
 *
 * NOT in this list — our custom /v1/auth/* routes (e.g. /v1/auth/cli-token):
 * those are session-cookie POSTs that mint long-lived bearers, so they MUST
 * fall through to the origin-check below. When you add a new Better Auth
 * route (e.g. by enabling a new plugin), add its prefix here. When you add
 * a new custom briven-owned route under /v1/auth/, do NOT add it here.
 *
 * Matched as either exact equality or `path === prefix + '/' + ...` so that
 * `/v1/auth/sign-in/email` and `/v1/auth/callback/google` both resolve.
 */
const BETTER_AUTH_PATHS: readonly string[] = [
  '/v1/auth/ok',
  '/v1/auth/error',
  // Sessions
  '/v1/auth/get-session',
  '/v1/auth/update-session',
  '/v1/auth/list-sessions',
  '/v1/auth/revoke-session',
  '/v1/auth/revoke-sessions',
  '/v1/auth/revoke-other-sessions',
  // Sign-in / sign-up / sign-out (prefix covers /email, /social, /magic-link, /oauth2, ...)
  '/v1/auth/sign-in',
  '/v1/auth/sign-up',
  '/v1/auth/sign-out',
  // OAuth callbacks
  '/v1/auth/callback',
  '/v1/auth/oauth2',
  // Magic link
  '/v1/auth/magic-link',
  // Email verification
  '/v1/auth/verify-email',
  '/v1/auth/send-verification-email',
  // Password
  '/v1/auth/request-password-reset',
  '/v1/auth/reset-password',
  '/v1/auth/change-password',
  '/v1/auth/verify-password',
  // User / account mutations
  '/v1/auth/change-email',
  '/v1/auth/update-user',
  '/v1/auth/delete-user',
  '/v1/auth/link-social',
  '/v1/auth/unlink-account',
  '/v1/auth/list-accounts',
  '/v1/auth/account-info',
  // Tokens
  '/v1/auth/refresh-token',
  '/v1/auth/get-access-token',
];

function isBetterAuthPath(path: string): boolean {
  for (const p of BETTER_AUTH_PATHS) {
    if (path === p || path.startsWith(p + '/')) return true;
  }
  return false;
}

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
 * we skip those (allowlisted in BETTER_AUTH_PATHS) to avoid double-counting.
 * Custom briven-owned routes under /v1/auth/ (e.g. /v1/auth/cli-token) are
 * NOT exempt and must pass the origin check like every other mutating route.
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
  if (isBetterAuthPath(input.path)) return false;
  if (!input.origin || !input.trustedOrigins.includes(input.origin)) return true;
  return false;
}

function trustedOrigins(): string[] {
  // Prefer the shared product-origin list (includes app./admin. aliases).
  const list = new Set<string>(brivenOwnOrigins());
  for (const o of env.BRIVEN_TRUSTED_ORIGINS.split(',').map((s) => s.trim())) {
    if (o) list.add(o.replace(/\/$/, ''));
  }
  return [...list];
}

export const csrfOriginCheck = (): MiddlewareHandler => async (c, next) => {
  // Bearer-token carve-out: CSRF is a browser-only attack vector — the
  // browser auto-attaches cookies, but it never auto-attaches an
  // `Authorization: Bearer …` header from a cross-origin form/fetch.
  // CLI requests (and any non-browser caller using a JWT) therefore
  // can't be CSRF'd and must skip the origin check entirely. This
  // sits above every other branch so it can't be defeated by a stray
  // session cookie tagging along on a bearer request.
  const authHeader = c.req.header('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) {
      await next();
      return;
    }
  }

  const session = c.get('session') as Session | null | undefined;
  const path = new URL(c.req.url).pathname;
  const origin = c.req.header('origin') ?? null;

  if (
    // A project-registered app domain (or briven-own origin) is trusted — skip
    // the CSRF rejection for it (supports wildcard subdomains).
    !isRegisteredOrigin(origin) &&
    shouldRejectAsCsrf({
      method: c.req.method,
      hasSession: Boolean(session),
      path,
      origin,
      trustedOrigins: trustedOrigins(),
    })
  ) {
    log.warn('csrf_origin_rejected', { path, method: c.req.method, origin });
    return c.json({ code: 'csrf_origin_rejected', message: 'request origin is not trusted' }, 403);
  }

  await next();
  return;
};
