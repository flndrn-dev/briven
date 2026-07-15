import { NextResponse, type NextRequest } from 'next/server';

// Better Auth picks the cookie name based on secure mode: in production
// it prefixes `__Secure-` (per the RFC-6265bis host-only rules). We
// accept either so the proxy works behind TLS in prod and HTTP in dev.
const SESSION_COOKIE_PROD = '__Secure-briven.session_token';
const SESSION_COOKIE_DEV = 'briven.session_token';

// Public api origin, safe to read at the edge (NEXT_PUBLIC_* is inlined at
// build time). This is the same value client components fetch against.
const API_ORIGIN = process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? '';

// The proxy runs on every request, so a fetch-per-request would hammer the
// api. Cache the maintenance flag in module scope — middleware module scope
// persists across requests inside a worker — and only re-fetch after the TTL.
const MAINTENANCE_TTL_MS = 30_000;
let maintenanceCache: { value: boolean; fetchedAt: number } | null = null;

/**
 * Is the platform in maintenance right now? Cached for ~30s to keep the
 * per-request cost near zero. On any fetch failure we FAIL OPEN (return
 * false) — a transient api hiccup must never lock the whole marketing site
 * behind the maintenance splash. The maintenance page itself renders the
 * authoritative state fetched server-side.
 */
async function isMaintenanceActive(): Promise<boolean> {
  const now = Date.now();
  if (maintenanceCache && now - maintenanceCache.fetchedAt < MAINTENANCE_TTL_MS) {
    return maintenanceCache.value;
  }
  if (!API_ORIGIN) return false;
  try {
    const res = await fetch(`${API_ORIGIN}/v1/status/maintenance`, {
      // Never let Next cache this — we manage freshness with the module cache.
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = (await res.json()) as { active?: boolean };
    const value = body.active === true;
    maintenanceCache = { value, fetchedAt: now };
    return value;
  } catch {
    // Fail open. Cache the "not in maintenance" result briefly too so a
    // flapping api doesn't turn into a fetch storm.
    maintenanceCache = { value: false, fetchedAt: now };
    return false;
  }
}

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
 * 3. Maintenance gate: when maintenance is active, public visitors get the
 *    /maintenance splash. The admin host, /signin, /maintenance itself and
 *    Next internals/assets/api stay exempt so an operator can still sign in,
 *    reach admin.briven.tech and flip it back off.
 */
export default async function proxy(req: NextRequest): Promise<NextResponse> {
  const { nextUrl } = req;

  const host = (req.headers.get('host') ?? '').split(':')[0] ?? '';
  const isAdminHost = host.startsWith('admin.');
  const isAuthHost = host.endsWith('.auth.briven.tech');

  if (isAdminHost && !nextUrl.pathname.startsWith('/admin')) {
    const url = nextUrl.clone();
    url.pathname = `/admin${nextUrl.pathname === '/' ? '' : nextUrl.pathname}`;
    return NextResponse.rewrite(url);
  }

  // Auth subdomain: <projectId>.auth.briven.tech/<flow> → serve hosted auth pages.
  if (isAuthHost) {
    const projectId = host.replace(/\.auth\.briven\.tech$/, '');
    // Valid project ids start with p_ and contain alphanumeric chars.
    if (/^p_[a-zA-Z0-9_]+$/.test(projectId)) {
      const url = nextUrl.clone();
      url.pathname = `/auth/${projectId}${nextUrl.pathname === '/' ? '/sign-in' : nextUrl.pathname}`;
      return NextResponse.rewrite(url);
    }
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

  // Maintenance splash for public visitors. Exemptions keep the operator's
  // escape hatch open: the admin host (so admin.briven.tech works), /signin
  // (so they can authenticate), and /maintenance itself (so the splash can
  // render). Next internals/api/asset paths never hit this matcher, so we
  // don't need to re-exclude them here.
  const path = nextUrl.pathname;
  const maintenanceExempt =
    isAdminHost || isAuthHost || path === '/signin' || path.startsWith('/maintenance');
  if (!maintenanceExempt && (await isMaintenanceActive())) {
    return NextResponse.rewrite(new URL('/maintenance', req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals, API routes, and file-looking paths
  // (favicon, images, fonts). The admin-host rewrite needs page
  // navigations broadly; non-matching requests fall through untouched.
  matcher: ['/((?!_next/|api/|.*\\..*).*)'],
};
