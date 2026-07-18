import { NextResponse, type NextRequest } from 'next/server';

const BRIVEN_API_ORIGIN = process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? 'https://api.briven.tech';
const BRIVEN_PROJECT_ID = process.env.NEXT_PUBLIC_BRIVEN_PROJECT_ID!;
const BRIVEN_AUTH_KEY =
  process.env.BRIVEN_AUTH_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_BRIVEN_AUTH_KEY!;

export async function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith('/api/auth/')) return NextResponse.next();

  const url = new URL(
    req.nextUrl.pathname.replace('/api/auth', '/v1/auth-tenant'),
    BRIVEN_API_ORIGIN,
  );
  url.search = req.nextUrl.search;

  const headers = new Headers(req.headers);
  headers.set('x-briven-project-id', BRIVEN_PROJECT_ID);
  headers.set('authorization', `Bearer ${BRIVEN_AUTH_KEY}`);

  return fetch(url, {
    method: req.method,
    headers,
    body: req.body,
    // @ts-expect-error — duplex required for streaming bodies in Node 18+
    duplex: 'half',
  });
}

export const config = {
  matcher: ['/api/auth/:path*'],
};
