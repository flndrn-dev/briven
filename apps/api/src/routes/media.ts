import { Hono } from 'hono';

import { openPublicObject, openOwnedObject } from '../services/storage.js';
import { resolveShareLink } from '../services/storage-share-links.js';
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

// Public: serve a file via a tokenized SHARE-LINK. No auth — the token IS the
// authorization. `resolveShareLink` is strict-deny: it returns the file ONLY for
// an active (unrevoked, unexpired) link whose token exact-matches. On any miss it
// returns null and we answer a plain 404 — deliberately NOT leaking whether the
// token, the link, or the file exists (all misses look identical).
//
// A valid link serves the file EVEN IF it is not marked public — that is the
// point of a private, time-limited link — so we open the OWNED object (not the
// public one). Same streaming idiom as /media. No CORS echo: a share-link is a
// direct bearer URL (opened by navigation/download), not a cross-origin fetch
// against a project's allow-listed app origins.
mediaRouter.get('/link/:token', async (c) => {
  const token = c.req.param('token');
  const resolved = await resolveShareLink(token);
  if (!resolved) return c.text('not found', 404);

  const obj = await openOwnedObject(resolved.projectId, resolved.fileId);
  if (!obj) return c.text('not found', 404);

  const headers: Record<string, string> = {
    'content-type': obj.contentType,
    // Private link → don't let shared caches fan it out.
    'cache-control': 'private, max-age=60',
  };
  if (obj.contentLength) headers['content-length'] = obj.contentLength;

  return new Response(obj.body, { status: 200, headers });
});
