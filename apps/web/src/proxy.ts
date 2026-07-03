import { NextResponse, type NextRequest } from 'next/server';

// Better Auth picks the cookie name based on secure mode: in production
// it prefixes `__Secure-` (per the RFC-6265bis host-only rules). We
// accept either so the proxy works behind TLS in prod and HTTP in dev.
const SESSION_COOKIE_PROD = '__Secure-briven.session_token';
const SESSION_COOKIE_DEV = 'briven.session_token';

/**
 * Request-time gating. In Next.js 16 this file replaces middleware.ts —
 * the named/default export must be `proxy`, not `middleware`. Matcher
 * shape is unchanged from 15.x.
 *
 * Two jobs:
 * 1. Admin subdomain: requests on `admin.<domain>` serve the
 *    (admin)/admin cockpit without the /admin path prefix —
 *    admin.briven.tech/users renders /admin/users. Paths already under
 *    /admin pass through, so internal /admin/... links keep working on
 *    the subdomain. Sessions carry over via cross-subdomain cookies.
 * 2. Dashboard gate: any path under `/dashboard` requires a Better Auth
 *    session cookie. Missing cookie → 302 to /signin?next=<path>. We
 *    intentionally do not validate the cookie here — cheap check at the
 *    edge, authoritative validation happens in the page via
 *    `requireUser()` calling apps/api.
 */
export default function proxy(req: NextRequest): NextResponse {
  const { nextUrl } = req;

  const host = (req.headers.get('host') ?? '').split(':')[0] ?? '';
  if (host.startsWith('admin.') && !nextUrl.pathname.startsWith('/admin')) {
    const url = nextUrl.clone();
    url.pathname = `/admin${nextUrl.pathname === '/' ? '' : nextUrl.pathname}`;
    return NextResponse.rewrite(url);
  }

  // The legacy admin area is retired in favour of the admin.briven.tech
  // cockpit — one admin surface, one address. Permanent redirect so old
  // bookmarks and stale links land in the right place.
  if (nextUrl.pathname.startsWith('/dashboard/admin')) {
    return NextResponse.redirect('https://admin.briven.tech', 308);
  }

  if (nextUrl.pathname.startsWith('/dashboard')) {
    const hasSession =
      req.cookies.has(SESSION_COOKIE_PROD) || req.cookies.has(SESSION_COOKIE_DEV);
    if (!hasSession) {
      const url = nextUrl.clone();
      url.pathname = '/signin';
      url.searchParams.set('next', nextUrl.pathname + nextUrl.search);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals, API routes, and file-looking paths
  // (favicon, images, fonts). The admin-host rewrite needs page
  // navigations broadly; non-matching requests fall through untouched.
  matcher: ['/((?!_next/|api/|.*\\..*).*)'],
};
