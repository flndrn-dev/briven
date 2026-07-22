/**
 * Full browser Google (and GitHub) OAuth start + callback for briven-engine.
 * DOLTGRES user store; cookies set on redirect host when possible.
 *
 *  GET /v1/auth-core/oauth/:provider/start?projectId=&redirect_uri=
 *  GET /v1/auth-core/oauth/:provider/callback?code=&state=
 */

import { Hono } from 'hono';

import { BRIVEN_ENGINE_ID } from '../services/auth-core/engine.js';
import {
  getAuthorisationUrl,
  signInUpWithCode,
  type SupportedSocial,
} from '../services/auth-core/thirdparty.js';
import type { AppEnv } from '../types/app-env.js';

export const authCoreOauthRouter = new Hono<AppEnv>();

const PROVIDERS = new Set(['google', 'github']);

authCoreOauthRouter.get('/v1/auth-core/oauth/:provider/start', async (c) => {
  const provider = c.req.param('provider') as SupportedSocial;
  if (!PROVIDERS.has(provider)) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, code: 'unsupported_provider' },
      400,
    );
  }
  const projectId = c.req.query('projectId') ?? undefined;
  const redirectURI =
    c.req.query('redirect_uri') ??
    c.req.query('redirectURI') ??
    `${new URL(c.req.url).origin}/v1/auth-core/oauth/${provider}/callback`;

  // Encode projectId into state storage via getAuthorisationUrl (already stores projectId)
  const result = await getAuthorisationUrl({
    thirdPartyId: provider,
    redirectURI,
    projectId,
  });
  if (result.status !== 'OK') {
    return c.json(result, 400);
  }

  // Optional: redirect browser straight to Google
  if (c.req.query('redirect') === '1' || c.req.query('go') === '1') {
    return c.redirect(result.urlWithQueryParams, 302);
  }
  return c.json({
    engine: BRIVEN_ENGINE_ID,
    storage: 'doltgres',
    ...result,
    callbackUrl: redirectURI,
  });
});

authCoreOauthRouter.get('/v1/auth-core/oauth/:provider/callback', async (c) => {
  const provider = c.req.param('provider') as SupportedSocial;
  if (!PROVIDERS.has(provider)) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, code: 'unsupported_provider' },
      400,
    );
  }
  const code = c.req.query('code');
  const state = c.req.query('state') ?? undefined;
  const err = c.req.query('error');
  if (err) {
    return c.html(
      `<!doctype html><html><body><p>OAuth error: ${escapeHtml(err)}</p></body></html>`,
      400,
    );
  }
  if (!code) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, code: 'code_required' },
      400,
    );
  }

  // redirect_uri must match what was used at start — reconstruct default
  const redirectURI = `${new URL(c.req.url).origin}/v1/auth-core/oauth/${provider}/callback`;

  // projectId is recovered from state map inside exchange
  const result = await signInUpWithCode({
    thirdPartyId: provider,
    code,
    redirectURI,
    state,
  });

  if (result.status !== 'OK') {
    return c.html(
      `<!doctype html><html><body>
        <p>Sign-in failed: ${escapeHtml(result.message)}</p>
        <p>engine: briven-engine · storage: doltgres</p>
      </body></html>`,
      400,
    );
  }

  // Set session cookies then show success (apps can replace with redirect)
  c.header(
    'Set-Cookie',
    `sAccessToken=${result.session.accessToken}; Path=/; HttpOnly; SameSite=Lax`,
    { append: true },
  );
  c.header(
    'Set-Cookie',
    `sRefreshToken=${result.session.refreshToken}; Path=/; HttpOnly; SameSite=Lax`,
    { append: true },
  );
  c.header(
    'Set-Cookie',
    `sFrontToken=${encodeURIComponent(JSON.stringify({ uid: result.user.id, up: {} }))}; Path=/; SameSite=Lax`,
    { append: true },
  );

  const appRedirect = c.req.query('app_redirect');
  if (appRedirect && isSafeRedirect(appRedirect)) {
    return c.redirect(appRedirect, 302);
  }

  return c.html(`<!doctype html><html><body style="font-family:monospace;padding:2rem">
    <h1>Signed in with ${escapeHtml(provider)}</h1>
    <p>user: ${escapeHtml(result.user.id)}</p>
    <p>email: ${escapeHtml(result.user.email ?? '')}</p>
    <p>tenant: ${escapeHtml(result.user.tenantId)}</p>
    <p>engine: briven-engine · storage: doltgres</p>
    <p>createdNewUser: ${result.createdNewUser}</p>
  </body></html>`);
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isSafeRedirect(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return url.startsWith('/');
  }
}
