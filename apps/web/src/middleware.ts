import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Host-based rewrite for the dedicated admin subdomain: requests arriving
 * on `admin.<domain>` serve the (admin)/admin cockpit routes without the
 * /admin path prefix — admin.briven.tech/users renders /admin/users.
 * Paths already under /admin pass through untouched, so internal links
 * (which use /admin/... hrefs) keep working on the subdomain too.
 * Sessions carry over because Better Auth sets cross-subdomain cookies.
 */
export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').split(':')[0] ?? '';
  if (host.startsWith('admin.') && !req.nextUrl.pathname.startsWith('/admin')) {
    const url = req.nextUrl.clone();
    url.pathname = `/admin${req.nextUrl.pathname === '/' ? '' : req.nextUrl.pathname}`;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip Next internals, API routes, and any file-looking path (favicon,
  // images, fonts) — only page navigations need the host rewrite.
  matcher: ['/((?!_next/|api/|.*\\..*).*)'],
};
