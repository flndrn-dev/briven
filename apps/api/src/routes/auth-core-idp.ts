/**
 * Briven Auth as OIDC / OAuth2 provider (SuperTokens-class surface).
 *
 * Public:
 *   GET  /v1/auth-core/oidc/.well-known/openid-configuration
 *   GET  /v1/auth-core/oidc/jwks.json
 *   GET  /v1/auth-core/oidc/authorize
 *   POST /v1/auth-core/oidc/token
 *   GET  /v1/auth-core/oidc/userinfo
 *   POST /v1/auth-core/oidc/revoke
 *   POST /v1/auth-core/oidc/introspect
 *   GET|POST /v1/auth-core/oidc/end_session
 *   GET  /v1/auth-core/oidc/challenge/:id
 *   POST /v1/auth-core/oidc/consent
 *
 * Dashboard (project admin):
 *   GET|POST /v1/auth-core/projects/:projectId/oidc/clients
 *   DELETE   /v1/auth-core/projects/:projectId/oidc/clients/:clientId
 */

import { Hono } from 'hono';

import { requireAuthCoreProject } from '../middleware/auth-core-guard.js';
import { BRIVEN_ENGINE_ID } from '../services/auth-core/engine.js';
import {
  createOidcClient,
  getOidcClientByClientId,
  listOidcClients,
  revokeOidcClient,
} from '../services/auth-core/idp-clients.js';
import { getOidcJwks } from '../services/auth-core/idp-signing.js';
import {
  attachUserToAuthRequest,
  buildUserInfo,
  createAuthRequest,
  denyAuthRequest,
  discoveryDocument,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  getAuthRequest,
  hasConsent,
  introspectToken,
  issueAuthCodeAndRedirect,
  oidcIssuer,
  revokeToken,
  webOrigin,
} from '../services/auth-core/idp-flow.js';
import { verifyAuthCoreSession } from '../services/auth-core/session.js';
import type { AppEnv } from '../types/app-env.js';
import type { User } from '../middleware/session.js';

export const authCoreIdpRouter = new Hono<AppEnv>();

// ─── Discovery + JWKS ────────────────────────────────────────────────

authCoreIdpRouter.get(
  '/v1/auth-core/oidc/.well-known/openid-configuration',
  (c) => c.json(discoveryDocument()),
);

authCoreIdpRouter.get('/v1/auth-core/oidc/jwks.json', async (c) => {
  try {
    return c.json(await getOidcJwks());
  } catch (err) {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        error: 'server_error',
        error_description: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});

// ─── Authorize ───────────────────────────────────────────────────────

authCoreIdpRouter.get('/v1/auth-core/oidc/authorize', async (c) => {
  const clientId = c.req.query('client_id') ?? '';
  const redirectUri = c.req.query('redirect_uri') ?? '';
  const responseType = c.req.query('response_type') ?? '';
  const scope = c.req.query('scope') ?? 'openid';
  const state = c.req.query('state') ?? null;
  const nonce = c.req.query('nonce') ?? null;
  const codeChallenge = c.req.query('code_challenge') ?? null;
  const codeChallengeMethod = c.req.query('code_challenge_method') ?? null;

  if (responseType !== 'code') {
    return c.json(
      {
        error: 'unsupported_response_type',
        error_description: 'only response_type=code is supported',
        engine: BRIVEN_ENGINE_ID,
      },
      400,
    );
  }

  const client = await getOidcClientByClientId(clientId);
  if (!client || client.revokedAt) {
    return c.json(
      {
        error: 'invalid_client',
        error_description: 'unknown client_id',
        engine: BRIVEN_ENGINE_ID,
      },
      400,
    );
  }

  let authReq;
  try {
    authReq = await createAuthRequest({
      client,
      redirectUri,
      scope,
      state,
      nonce,
      codeChallenge,
      codeChallengeMethod,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'invalid_redirect_uri') {
      return c.json(
        {
          error: 'invalid_request',
          error_description: 'redirect_uri not registered for this client',
          engine: BRIVEN_ENGINE_ID,
        },
        400,
      );
    }
    return c.json(
      {
        error: 'invalid_request',
        error_description: msg,
        engine: BRIVEN_ENGINE_ID,
      },
      400,
    );
  }

  // If already logged in + consented, short-circuit to code
  const session = await verifyAuthCoreSession({
    url: c.req.url,
    method: c.req.method,
    headers: c.req.raw.headers,
    cookieHeader: c.req.header('cookie'),
  });

  if (session.ok) {
    const userId = session.session.getUserId();
    await attachUserToAuthRequest(authReq.id, userId);
    const consented = await hasConsent(userId, client.clientId, authReq.scope);
    if (consented) {
      const { redirectUrl } = await issueAuthCodeAndRedirect(authReq.id, userId);
      return c.redirect(redirectUrl, 302);
    }
    const consentUrl = `${webOrigin()}/auth/${encodeURIComponent(client.projectId)}/oauth/consent?challenge=${encodeURIComponent(authReq.id)}`;
    return c.redirect(consentUrl, 302);
  }

  // Not logged in → hosted login, then consent
  const afterLogin = `${webOrigin()}/auth/${encodeURIComponent(client.projectId)}/oauth/consent?challenge=${encodeURIComponent(authReq.id)}`;
  const loginUrl = `${webOrigin()}/auth/${encodeURIComponent(client.projectId)}/otp?callbackURL=${encodeURIComponent(afterLogin)}`;
  return c.redirect(loginUrl, 302);
});

// ─── Challenge (for consent UI) ──────────────────────────────────────

authCoreIdpRouter.get('/v1/auth-core/oidc/challenge/:id', async (c) => {
  const id = c.req.param('id');
  const req = await getAuthRequest(id);
  if (!req) {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        error: 'invalid_request',
        error_description: 'challenge expired or unknown',
      },
      404,
    );
  }
  const client = await getOidcClientByClientId(req.clientId);
  if (!client) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, error: 'invalid_client' },
      400,
    );
  }
  return c.json({
    engine: BRIVEN_ENGINE_ID,
    challenge: req.id,
    projectId: req.projectId,
    scope: req.scope,
    scopes: req.scope.split(/\s+/),
    client: {
      clientId: client.clientId,
      name: client.name,
      logoUrl: client.logoUrl,
    },
  });
});

// ─── Consent accept / deny ───────────────────────────────────────────

authCoreIdpRouter.post('/v1/auth-core/oidc/consent', async (c) => {
  let body: { challenge?: string; decision?: 'allow' | 'deny' } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const challenge = body.challenge?.trim() ?? '';
  const decision = body.decision === 'deny' ? 'deny' : 'allow';
  if (!challenge) {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        error: 'invalid_request',
        error_description: 'challenge required',
      },
      400,
    );
  }

  const session = await verifyAuthCoreSession({
    url: c.req.url,
    method: c.req.method,
    headers: c.req.raw.headers,
    cookieHeader: c.req.header('cookie'),
  });
  if (!session.ok) {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        error: 'login_required',
        error_description: 'sign in before consenting',
      },
      401,
    );
  }
  const userId = session.session.getUserId();

  try {
    if (decision === 'deny') {
      const { redirectUrl } = await denyAuthRequest(challenge);
      return c.json({ engine: BRIVEN_ENGINE_ID, redirectUrl });
    }
    await attachUserToAuthRequest(challenge, userId);
    const { redirectUrl } = await issueAuthCodeAndRedirect(challenge, userId);
    return c.json({ engine: BRIVEN_ENGINE_ID, redirectUrl });
  } catch (err) {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        error: 'server_error',
        error_description: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }
});

// ─── Token ───────────────────────────────────────────────────────────

async function parseTokenBody(c: {
  req: {
    header: (n: string) => string | undefined;
    parseBody: () => Promise<Record<string, unknown>>;
    json: () => Promise<Record<string, unknown>>;
  };
}): Promise<{
  grant_type: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
  code_verifier?: string;
  refresh_token?: string;
}> {
  let clientId = '';
  let clientSecret = '';
  const auth = c.req.header('authorization');
  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      if (i > 0) {
        clientId = decoded.slice(0, i);
        clientSecret = decoded.slice(i + 1);
      }
    } catch {
      /* ignore */
    }
  }

  const ct = c.req.header('content-type') ?? '';
  let body: Record<string, unknown> = {};
  if (ct.includes('application/x-www-form-urlencoded')) {
    body = (await c.req.parseBody()) as Record<string, unknown>;
  } else {
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
  }

  return {
    grant_type: String(body.grant_type ?? ''),
    code: body.code != null ? String(body.code) : undefined,
    redirect_uri:
      body.redirect_uri != null ? String(body.redirect_uri) : undefined,
    client_id: clientId || (body.client_id != null ? String(body.client_id) : undefined),
    client_secret:
      clientSecret ||
      (body.client_secret != null ? String(body.client_secret) : undefined),
    code_verifier:
      body.code_verifier != null ? String(body.code_verifier) : undefined,
    refresh_token:
      body.refresh_token != null ? String(body.refresh_token) : undefined,
  };
}

authCoreIdpRouter.post('/v1/auth-core/oidc/token', async (c) => {
  const body = await parseTokenBody(c);
  if (!body.client_id) {
    return c.json(
      {
        error: 'invalid_client',
        error_description: 'client_id required',
        engine: BRIVEN_ENGINE_ID,
      },
      401,
    );
  }

  if (body.grant_type === 'authorization_code') {
    if (!body.code || !body.redirect_uri) {
      return c.json(
        {
          error: 'invalid_request',
          error_description: 'code and redirect_uri required',
          engine: BRIVEN_ENGINE_ID,
        },
        400,
      );
    }
    const result = await exchangeAuthorizationCode({
      code: body.code,
      redirectUri: body.redirect_uri,
      clientId: body.client_id,
      clientSecret: body.client_secret,
      codeVerifier: body.code_verifier,
    });
    if (!result.ok) {
      return c.json(
        {
          error: result.error,
          error_description: result.error_description,
          engine: BRIVEN_ENGINE_ID,
        },
        400,
      );
    }
    return c.json({
      access_token: result.access_token,
      id_token: result.id_token,
      refresh_token: result.refresh_token,
      token_type: result.token_type,
      expires_in: result.expires_in,
      scope: result.scope,
      engine: BRIVEN_ENGINE_ID,
    });
  }

  if (body.grant_type === 'refresh_token') {
    if (!body.refresh_token) {
      return c.json(
        {
          error: 'invalid_request',
          error_description: 'refresh_token required',
          engine: BRIVEN_ENGINE_ID,
        },
        400,
      );
    }
    const result = await exchangeRefreshToken({
      refreshToken: body.refresh_token,
      clientId: body.client_id,
      clientSecret: body.client_secret,
    });
    if (!result.ok) {
      return c.json(
        {
          error: result.error,
          error_description: result.error_description,
          engine: BRIVEN_ENGINE_ID,
        },
        400,
      );
    }
    return c.json({
      access_token: result.access_token,
      id_token: result.id_token,
      refresh_token: result.refresh_token,
      token_type: result.token_type,
      expires_in: result.expires_in,
      scope: result.scope,
      engine: BRIVEN_ENGINE_ID,
    });
  }

  return c.json(
    {
      error: 'unsupported_grant_type',
      error_description: 'authorization_code and refresh_token only',
      engine: BRIVEN_ENGINE_ID,
    },
    400,
  );
});

// ─── UserInfo ────────────────────────────────────────────────────────

authCoreIdpRouter.get('/v1/auth-core/oidc/userinfo', async (c) => {
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    return c.json({ error: 'invalid_token', engine: BRIVEN_ENGINE_ID }, 401);
  }
  const result = await buildUserInfo(token);
  if (!result.ok) {
    return c.json({ error: result.error, engine: BRIVEN_ENGINE_ID }, result.status as 401);
  }
  return c.json(result.body);
});

authCoreIdpRouter.post('/v1/auth-core/oidc/userinfo', async (c) => {
  const auth = c.req.header('authorization') ?? '';
  let token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    const ct = c.req.header('content-type') ?? '';
    if (ct.includes('application/x-www-form-urlencoded')) {
      const form = await c.req.parseBody();
      token = String(form.access_token ?? '');
    }
  }
  if (!token) {
    return c.json({ error: 'invalid_token', engine: BRIVEN_ENGINE_ID }, 401);
  }
  const result = await buildUserInfo(token);
  if (!result.ok) {
    return c.json({ error: result.error, engine: BRIVEN_ENGINE_ID }, result.status as 401);
  }
  return c.json(result.body);
});

// ─── Revoke / introspect ─────────────────────────────────────────────

async function parseClientAuthAndToken(c: {
  req: {
    header: (n: string) => string | undefined;
    parseBody: () => Promise<Record<string, unknown>>;
    json: () => Promise<Record<string, unknown>>;
  };
}): Promise<{ clientId: string; clientSecret: string; token: string }> {
  let clientId = '';
  let clientSecret = '';
  const auth = c.req.header('authorization');
  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      if (i > 0) {
        clientId = decoded.slice(0, i);
        clientSecret = decoded.slice(i + 1);
      }
    } catch {
      /* ignore */
    }
  }
  let token = '';
  const ct = c.req.header('content-type') ?? '';
  try {
    if (ct.includes('application/x-www-form-urlencoded')) {
      const form = await c.req.parseBody();
      token = String(form.token ?? '');
      if (!clientId) clientId = String(form.client_id ?? '');
      if (!clientSecret) clientSecret = String(form.client_secret ?? '');
    } else {
      const body = (await c.req.json()) as {
        token?: string;
        client_id?: string;
        client_secret?: string;
      };
      token = body.token ?? '';
      if (!clientId) clientId = body.client_id ?? '';
      if (!clientSecret) clientSecret = body.client_secret ?? '';
    }
  } catch {
    /* empty */
  }
  return { clientId, clientSecret, token };
}

authCoreIdpRouter.post('/v1/auth-core/oidc/revoke', async (c) => {
  const { clientId, clientSecret, token } = await parseClientAuthAndToken(c);
  if (clientId && token) {
    await revokeToken({ token, clientId, clientSecret });
  }
  // RFC 7009: 200 even if token unknown
  return c.json({ engine: BRIVEN_ENGINE_ID });
});

authCoreIdpRouter.post('/v1/auth-core/oidc/introspect', async (c) => {
  const { clientId, clientSecret, token } = await parseClientAuthAndToken(c);
  if (!clientId || !token) {
    return c.json({ active: false, engine: BRIVEN_ENGINE_ID });
  }
  const result = await introspectToken({
    token,
    clientId,
    clientSecret,
  });
  return c.json({ ...result, engine: BRIVEN_ENGINE_ID });
});

// ─── End session (logout) ────────────────────────────────────────────

authCoreIdpRouter.get('/v1/auth-core/oidc/end_session', async (c) => {
  const postLogout = c.req.query('post_logout_redirect_uri');
  const state = c.req.query('state');
  // Clear engine session cookies best-effort
  c.header(
    'Set-Cookie',
    'sAccessToken=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    { append: true },
  );
  c.header(
    'Set-Cookie',
    'sRefreshToken=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    { append: true },
  );
  if (postLogout) {
    try {
      const u = new URL(postLogout);
      if (state) u.searchParams.set('state', state);
      return c.redirect(u.toString(), 302);
    } catch {
      /* fall through */
    }
  }
  return c.html(
    `<!doctype html><html><body style="font-family:monospace;padding:2rem">
      <p>signed out of briven auth</p>
      <p>engine: briven-engine</p>
    </body></html>`,
  );
});

authCoreIdpRouter.post('/v1/auth-core/oidc/end_session', async (c) => {
  // Same behaviour as GET (form_post style clients)
  const url = new URL(c.req.url);
  let postLogout = url.searchParams.get('post_logout_redirect_uri');
  let state = url.searchParams.get('state');
  try {
    const ct = c.req.header('content-type') ?? '';
    if (ct.includes('application/x-www-form-urlencoded')) {
      const form = await c.req.parseBody();
      if (!postLogout) postLogout = String(form.post_logout_redirect_uri ?? '') || null;
      if (!state) state = String(form.state ?? '') || null;
    }
  } catch {
    /* ignore */
  }
  c.header(
    'Set-Cookie',
    'sAccessToken=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    { append: true },
  );
  c.header(
    'Set-Cookie',
    'sRefreshToken=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    { append: true },
  );
  if (postLogout) {
    try {
      const u = new URL(postLogout);
      if (state) u.searchParams.set('state', state);
      return c.redirect(u.toString(), 302);
    } catch {
      /* fall through */
    }
  }
  return c.html(
    `<!doctype html><html><body style="font-family:monospace;padding:2rem">
      <p>signed out of briven auth</p>
      <p>engine: briven-engine</p>
    </body></html>`,
  );
});

// ─── Client admin (dashboard) ────────────────────────────────────────

authCoreIdpRouter.use(
  '/v1/auth-core/projects/:projectId/oidc/clients',
  ...requireAuthCoreProject('admin'),
);
authCoreIdpRouter.use(
  '/v1/auth-core/projects/:projectId/oidc/clients/*',
  ...requireAuthCoreProject('admin'),
);

authCoreIdpRouter.get(
  '/v1/auth-core/projects/:projectId/oidc/clients',
  async (c) => {
    const projectId = c.req.param('projectId');
    try {
      const clients = await listOidcClients(projectId);
      return c.json({
        engine: BRIVEN_ENGINE_ID,
        projectId,
        issuer: oidcIssuer(),
        discovery: `${oidcIssuer()}/.well-known/openid-configuration`,
        clients: clients.map((cl) => ({
          id: cl.id,
          clientId: cl.clientId,
          name: cl.name,
          logoUrl: cl.logoUrl,
          isPublic: cl.isPublic,
          redirectUris: cl.redirectUris,
          scopes: cl.scopes,
          hint: cl.secretSuffix ? `…${cl.secretSuffix}` : null,
          revokedAt: cl.revokedAt,
          createdAt: cl.createdAt,
        })),
      });
    } catch (err) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'list_failed',
          message: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }
  },
);

authCoreIdpRouter.post(
  '/v1/auth-core/projects/:projectId/oidc/clients',
  async (c) => {
    const projectId = c.req.param('projectId');
    let body: {
      name?: string;
      redirectUris?: string[];
      logoUrl?: string;
      isPublic?: boolean;
      postLogoutUris?: string[];
    } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const user = c.get('user') as User | null;
    try {
      const created = await createOidcClient({
        projectId,
        name: body.name ?? '',
        redirectUris: body.redirectUris ?? [],
        logoUrl: body.logoUrl,
        isPublic: body.isPublic,
        postLogoutUris: body.postLogoutUris,
        createdBy: user?.id ?? null,
      });
      return c.json({
        engine: BRIVEN_ENGINE_ID,
        projectId,
        issuer: oidcIssuer(),
        client: {
          id: created.client.id,
          clientId: created.client.clientId,
          name: created.client.name,
          logoUrl: created.client.logoUrl,
          isPublic: created.client.isPublic,
          redirectUris: created.client.redirectUris,
          /** Shown once for confidential clients */
          clientSecret: created.clientSecret,
        },
        note: created.clientSecret
          ? 'Copy client_secret now — it is not shown again.'
          : 'Public client — use PKCE (S256); no client_secret.',
      });
    } catch (err) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'create_failed',
          message: err instanceof Error ? err.message : String(err),
        },
        400,
      );
    }
  },
);

authCoreIdpRouter.delete(
  '/v1/auth-core/projects/:projectId/oidc/clients/:clientId',
  async (c) => {
    const projectId = c.req.param('projectId');
    const clientId = c.req.param('clientId');
    try {
      await revokeOidcClient(projectId, clientId);
      return c.json({
        engine: BRIVEN_ENGINE_ID,
        ok: true,
        projectId,
        clientId,
      });
    } catch (err) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'revoke_failed',
          message: err instanceof Error ? err.message : String(err),
        },
        404,
      );
    }
  },
);
