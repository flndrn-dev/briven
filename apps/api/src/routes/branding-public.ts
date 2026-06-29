import { Hono } from 'hono';

import { getBrandingLogo, isStorageConfigured } from '../services/auth-branding-logo.js';
import { getAuthConfig } from '../services/tenant-config-store.js';

/**
 * Public, UNAUTHENTICATED branding-logo route — lives in its OWN router on
 * purpose so `index.ts` can mount it BEFORE every project-auth guard.
 *
 * Previously this handler lived inside `authServiceRouter`, which broke it two
 * ways on live: (1) `authServiceRouter` is mounted after `projectsRouter`,
 * whose `/v1/projects/:id/*` auth middleware fired first and returned
 * `401 authentication required`; and (2) the whole auth service is gated behind
 * `BRIVEN_AUTH_ENABLED`. But a hosted login page (and any embedder) loads the
 * logo via a plain `<img src>`, so it must serve with no session/key AND
 * regardless of the auth-service kill switch. Mounting this router first makes
 * its handler the first match — it returns a Response and ends the chain before
 * any guard runs. The URL is unchanged, so existing `branding.logoUrl` values
 * keep working.
 *
 * The object stays PRIVATE in storage; we proxy the bytes with the stored
 * content-type. `nosniff` + a locked-down CSP stop a customer-supplied SVG from
 * being treated as anything other than an image.
 */
export const brandingPublicRouter = new Hono();

brandingPublicRouter.get('/v1/projects/:id/auth/branding/logo', async (c) => {
  const projectId = c.req.param('id');
  if (!projectId) {
    return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
  }
  if (!isStorageConfigured()) {
    return c.json({ code: 'storage_not_configured' }, 503);
  }
  const obj = await getBrandingLogo(projectId);
  if (!obj) {
    return c.json({ code: 'not_found' }, 404);
  }
  return new Response(obj.bytes, {
    status: 200,
    headers: {
      'content-type': obj.contentType,
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
});

/**
 * Public, UNAUTHENTICATED branding-CONFIG route — sibling of the logo route
 * above and mounted on the same router (before every project-auth guard), for
 * the same reason: the hosted login pages render server-side with NO admin
 * session, so they can't read the admin-gated `/v1/projects/:id/auth/config`
 * (it 401s) to pick up the tenant's accent colour.
 *
 * Returns ONLY non-sensitive presentation fields — `primaryColor` and
 * `senderName`. Nothing here is a secret: no provider client ids, no domains,
 * no toggles. `getAuthConfig` returns the frozen defaults when a project has
 * no config row yet, so this always yields a usable colour.
 */
brandingPublicRouter.get('/v1/projects/:id/auth/branding/config', async (c) => {
  const projectId = c.req.param('id');
  if (!projectId) {
    return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
  }
  const config = await getAuthConfig(projectId);
  return c.json(
    {
      primaryColor: config.branding.primaryColor,
      senderName: config.branding.senderName,
    },
    200,
    { 'cache-control': 'public, max-age=60' },
  );
});
