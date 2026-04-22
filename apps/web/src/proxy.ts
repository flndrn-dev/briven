import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'briven.session_token';

/**
 * Request-time gating. In Next.js 16 this file replaces middleware.ts — the
 * named/default export must be `proxy`, not `middleware`. The matcher shape
 * is unchanged from 15.x.
 *
 * Gate: any path under `/dashboard` requires a Better Auth session cookie.
 * Missing cookie → 302 to /signin?next=<original-path>. We intentionally do
 * not validate the cookie here — cheap check at the edge, authoritative
 * validation happens in the page via `requireUser()` calling apps/api.
 */
export default function proxy(req: NextRequest): NextResponse {
  const { nextUrl } = req;
  const hasSession = req.cookies.has(SESSION_COOKIE);

  if (!hasSession) {
    const url = nextUrl.clone();
    url.pathname = '/signin';
    url.searchParams.set('next', nextUrl.pathname + nextUrl.search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
