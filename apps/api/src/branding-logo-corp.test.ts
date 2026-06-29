/**
 * Branding-logo Cross-Origin-Resource-Policy override (bug: logo renders as a
 * broken-image icon on the dashboard).
 *
 * The public logo route serves 200/image-png fine, but secureHeaders() stamps
 * `Cross-Origin-Resource-Policy: same-origin` on every response — so a browser
 * refuses to render the image when it's embedded cross-origin (dashboard at
 * briven.tech, logo at api.briven.tech). index.ts fixes this with a path-scoped
 * middleware registered BEFORE secureHeaders, whose post-`next()` write is the
 * OUTERMOST and therefore wins, flipping ONLY the logo route to `cross-origin`.
 *
 * This test pins that ordering invariant in isolation (no DB/env): the override
 * must win on the logo path, and every other path must stay same-origin.
 */
import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

const LOGO_PATH = '/v1/projects/:id/auth/branding/logo';

function buildApp() {
  const app = new Hono();
  // Mirror index.ts ordering EXACTLY: the override is registered BEFORE
  // secureHeaders so it wraps it and its post-next() set runs last.
  app.use(LOGO_PATH, async (c, next) => {
    await next();
    c.res.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  });
  app.use('*', secureHeaders());
  app.get(LOGO_PATH, () => new Response('PNGBYTES', { headers: { 'content-type': 'image/png' } }));
  app.get('/v1/other', (c) => c.json({ ok: true }));
  return app;
}

describe('branding logo CORP override', () => {
  test('logo route serves Cross-Origin-Resource-Policy: cross-origin (override wins)', async () => {
    const app = buildApp();
    const res = await app.request('/v1/projects/p_abc123/auth/branding/logo');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  });

  test('every other route keeps the secure default (same-origin)', async () => {
    const app = buildApp();
    const res = await app.request('/v1/other');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
  });
});
