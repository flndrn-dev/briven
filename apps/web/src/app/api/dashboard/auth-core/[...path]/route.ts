import { cookies, headers } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side proxy for briven-engine dashboard mutations.
 *
 * Browser → same-origin `/api/dashboard/auth-core/...`
 * Next forwards cookies + Origin so API CSRF + session auth succeed.
 * (Next rewrites alone can drop Origin on PUT and CSRF rejects the write.)
 */

export const dynamic = 'force-dynamic';

function apiOrigin(): string {
  return (
    process.env.BRIVEN_API_ORIGIN ??
    process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ??
    'http://localhost:3001'
  ).replace(/\/$/, '');
}

function webOrigin(): string {
  return (
    process.env.BRIVEN_WEB_ORIGIN ??
    process.env.NEXT_PUBLIC_BRIVEN_WEB_ORIGIN ??
    'https://briven.tech'
  ).replace(/\/$/, '');
}

async function proxy(
  req: NextRequest,
  pathParts: string[],
): Promise<NextResponse> {
  const rest = pathParts.join('/');
  if (!rest || rest.includes('..')) {
    return NextResponse.json({ code: 'not_found' }, { status: 404 });
  }

  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const inbound = await headers();
  const origin =
    inbound.get('origin') ||
    webOrigin();

  const dest = `${apiOrigin()}/v1/auth-core/${rest}${req.nextUrl.search}`;

  const init: RequestInit = {
    method: req.method,
    headers: {
      cookie: cookieHeader,
      origin,
      accept: 'application/json',
      'x-forwarded-for':
        inbound.get('x-forwarded-for') ?? inbound.get('x-real-ip') ?? '',
    },
    cache: 'no-store',
    redirect: 'manual',
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const contentType = req.headers.get('content-type') ?? '';
    // Multipart logo uploads must keep the boundary + binary body intact.
    // `req.text()` would corrupt the file and break Hono parseBody().
    if (contentType.toLowerCase().includes('multipart/form-data')) {
      const buf = await req.arrayBuffer();
      if (buf.byteLength > 0) {
        (init.headers as Record<string, string>)['content-type'] = contentType;
        init.body = buf;
      }
    } else {
      const body = await req.text();
      if (body) {
        (init.headers as Record<string, string>)['content-type'] =
          contentType || 'application/json';
        init.body = body;
      }
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(dest, init);
  } catch (err) {
    return NextResponse.json(
      {
        code: 'upstream_unreachable',
        message:
          err instanceof Error ? err.message : 'auth API unreachable',
      },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  return new NextResponse(text || null, {
    status: upstream.status,
    headers: {
      'content-type':
        upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  });
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}
