/**
 * Example first-party proxy for Next.js App Router (copy into your app).
 *
 * File: app/api/auth/[...path]/route.ts
 *
 * Browser talks to same origin /api/auth/* → cookies on YOUR domain.
 * This forwards to Briven API briven-engine FDI.
 *
 *   import { brivenEngineProxyTarget } from '@briven/auth/engine';
 *
 * Not imported by default — reference only so apps can paste.
 */

export const NEXT_PROXY_SNIPPET = `
// app/api/auth/[...path]/route.ts
import { brivenEngineProxyTarget } from '@briven/auth/engine';

const TARGET = brivenEngineProxyTarget(process.env.BRIVEN_API_ORIGIN);

async function proxy(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = new URL(req.url);
  const dest = \`\${TARGET}/\${path.join('/')}\${url.search}\`;
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.set('x-briven-engine', 'briven-engine');
  const res = await fetch(dest, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
    redirect: 'manual',
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const PATCH = proxy;
`.trim();
