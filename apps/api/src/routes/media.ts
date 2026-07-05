import { Hono } from 'hono';

import { openPublicObject } from '../services/storage.js';
import { originsForProject, brivenOwnOrigins } from '../services/auth-origin-allowlist.js';

export const mediaRouter = new Hono();

// Public: serve a file that's been marked public, from the clean media host.
// No auth. Per-tenant CORS: echo the requesting Origin only if it's in the
// project's allowed-domains (or a briven-own origin).
//
// Bodies are streamed through `new Response(ReadableStream, ...)` — the same
// idiom the branding-logo + AI-stream routes use for serving object bytes —
// so we build every header (incl. the tenant-scoped CORS ones) manually.
mediaRouter.get('/media/:projectId/:fileId', async (c) => {
  const projectId = c.req.param('projectId');
  const fileId = c.req.param('fileId');
  const obj = await openPublicObject(projectId, fileId);
  if (!obj) return c.text('not found', 404);

  const headers: Record<string, string> = {
    'content-type': obj.contentType,
    'cache-control': 'public, max-age=300',
  };
  if (obj.contentLength) headers['content-length'] = obj.contentLength;

  const origin = c.req.header('origin');
  if (origin) {
    const allowed = await originsForProject(projectId).catch(() => [] as string[]);
    if (allowed.includes(origin) || brivenOwnOrigins().includes(origin)) {
      headers['access-control-allow-origin'] = origin;
      headers['vary'] = 'Origin';
    }
  }

  return new Response(obj.body, { status: 200, headers });
});
