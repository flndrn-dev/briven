/**
 * briven-engine enterprise SSO routes (Phase enterprise).
 *
 * Admin (dashboard session + project admin):
 *   GET/POST /v1/auth-core/projects/:projectId/sso/connections
 *   PATCH/DELETE .../sso/connections/:connectionId
 *
 * Login (public ACS / OIDC callback):
 *   GET  /v1/auth-core/sso/saml/:connectionId
 *   POST /v1/auth-core/sso/saml/:connectionId/acs
 *   GET  /v1/auth-core/sso/saml/:connectionId/metadata
 *   GET  /v1/auth-core/sso/oidc/:connectionId
 *   GET  /v1/auth-core/sso/oidc/:connectionId/callback
 */

import { Hono } from 'hono';
import { sanitizeRelayState } from '../services/auth-hardening.js';
import { setCookie } from 'hono/cookie';

import {
  requireAuthCoreDashboard,
  requireAuthCoreProject,
} from '../middleware/auth-core-guard.js';
import { BRIVEN_ENGINE_ID, isAuthCoreInitialized } from '../services/auth-core/engine.js';
import {
  completeOidcLogin,
  completeSamlLogin,
  createEngineSsoConnection,
  deactivateEngineSsoConnection,
  generateSamlMetadataXml,
  getEngineSsoConnection,
  listEngineSsoConnections,
  publicSsoConnection,
  startOidcLogin,
  startSamlLogin,
  updateEngineSsoConnection,
  type SsoProviderType,
} from '../services/auth-core/sso.js';
import type { AppEnv } from '../types/app-env.js';

export const authCoreSsoRouter = new Hono<AppEnv>();

authCoreSsoRouter.use(
  '/v1/auth-core/projects/:projectId/sso/*',
  ...requireAuthCoreProject('admin'),
);

// ─── Admin CRUD ───────────────────────────────────────────────────────────

authCoreSsoRouter.get(
  '/v1/auth-core/projects/:projectId/sso/connections',
  async (c) => {
    if (!isAuthCoreInitialized()) {
      return c.json(
        { engine: BRIVEN_ENGINE_ID, code: 'auth_core_sdk_not_ready', connections: [] },
        503,
      );
    }
    const projectId = c.req.param('projectId');
    const connections = await listEngineSsoConnections(projectId);
    return c.json({
      engine: BRIVEN_ENGINE_ID,
      storage: 'doltgres',
      projectId,
      connections: connections.map(publicSsoConnection),
      productNote:
        'SAML + OIDC enterprise SSO on briven-engine. productionReady=true when IdP fields are complete.',
    });
  },
);

authCoreSsoRouter.post(
  '/v1/auth-core/projects/:projectId/sso/connections',
  async (c) => {
    const projectId = c.req.param('projectId');
    let body: {
      name?: string;
      providerType?: SsoProviderType;
      domains?: string[];
      config?: Record<string, unknown>;
      jitEnabled?: boolean;
    } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    if (!body.name || !body.providerType) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'bad_request',
          message: 'name and providerType (saml|oidc) required',
        },
        400,
      );
    }
    try {
      const connection = await createEngineSsoConnection({
        projectId,
        name: body.name,
        providerType: body.providerType,
        domains: body.domains,
        config: body.config,
        jitEnabled: body.jitEnabled,
      });
      return c.json({
        engine: BRIVEN_ENGINE_ID,
        connection: publicSsoConnection(connection),
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

authCoreSsoRouter.patch(
  '/v1/auth-core/projects/:projectId/sso/connections/:connectionId',
  async (c) => {
    const connectionId = c.req.param('connectionId');
    const projectId = c.req.param('projectId');
    const existing = await getEngineSsoConnection(connectionId);
    if (!existing || existing.projectId !== projectId) {
      return c.json({ engine: BRIVEN_ENGINE_ID, code: 'not_found' }, 404);
    }
    let body: {
      name?: string;
      domains?: string[];
      config?: Record<string, unknown>;
      jitEnabled?: boolean;
    } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const updated = await updateEngineSsoConnection(connectionId, body);
    if (!updated) {
      return c.json({ engine: BRIVEN_ENGINE_ID, code: 'not_found' }, 404);
    }
    return c.json({
      engine: BRIVEN_ENGINE_ID,
      connection: publicSsoConnection(updated),
    });
  },
);

authCoreSsoRouter.delete(
  '/v1/auth-core/projects/:projectId/sso/connections/:connectionId',
  async (c) => {
    const connectionId = c.req.param('connectionId');
    const projectId = c.req.param('projectId');
    const existing = await getEngineSsoConnection(connectionId);
    if (!existing || existing.projectId !== projectId) {
      return c.json({ engine: BRIVEN_ENGINE_ID, code: 'not_found' }, 404);
    }
    await deactivateEngineSsoConnection(connectionId);
    return c.json({ engine: BRIVEN_ENGINE_ID, ok: true, connectionId });
  },
);

// Dashboard-only list all ready connections across tenants (operator overview)
authCoreSsoRouter.get(
  '/v1/auth-core/sso/status',
  requireAuthCoreDashboard(),
  async (c) => {
    return c.json({
      engine: BRIVEN_ENGINE_ID,
      storage: 'doltgres',
      product: 'Briven Auth enterprise SSO',
      saml: {
        start: 'GET /v1/auth-core/sso/saml/:connectionId',
        acs: 'POST /v1/auth-core/sso/saml/:connectionId/acs',
        metadata: 'GET /v1/auth-core/sso/saml/:connectionId/metadata',
      },
      oidc: {
        start: 'GET /v1/auth-core/sso/oidc/:connectionId',
        callback: 'GET /v1/auth-core/sso/oidc/:connectionId/callback',
      },
      note: 'Configure connections under Enterprise tab. productionReady when IdP SSO URL+cert (SAML) or client id/secret+issuer/URLs (OIDC) are set.',
    });
  },
);

// ─── Public login ─────────────────────────────────────────────────────────

authCoreSsoRouter.get('/v1/auth-core/sso/saml/:connectionId/metadata', async (c) => {
  try {
    const xml = await generateSamlMetadataXml(c.req.param('connectionId'));
    return c.body(xml, 200, { 'content-type': 'application/xml; charset=utf-8' });
  } catch (err) {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        code: 'metadata_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }
});

authCoreSsoRouter.get('/v1/auth-core/sso/saml/:connectionId', async (c) => {
  try {
    const relayState = c.req.query('relayState') ?? undefined;
    const { redirectUrl } = await startSamlLogin(
      c.req.param('connectionId'),
      relayState,
    );
    return c.redirect(redirectUrl, 302);
  } catch (err) {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        code: 'saml_start_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }
});

authCoreSsoRouter.post('/v1/auth-core/sso/saml/:connectionId/acs', async (c) => {
  try {
    const body = await c.req.parseBody();
    const samlResponse =
      typeof body.SAMLResponse === 'string' ? body.SAMLResponse : '';
    if (!samlResponse) {
      return c.json(
        { engine: BRIVEN_ENGINE_ID, code: 'SAMLResponse_required' },
        400,
      );
    }
    const result = await completeSamlLogin({
      connectionId: c.req.param('connectionId'),
      samlResponse,
    });
    setCookie(c, 'sAccessToken', result.accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    // Open-redirect guard: only allowlisted origins (or relative paths).
    let allowedOrigins: string[] = [];
    try {
      const { getBrivenEngineAppOrigins } = await import(
        '../services/auth-core/project-config.js'
      );
      if (result.projectId) {
        allowedOrigins = await getBrivenEngineAppOrigins(result.projectId);
      }
    } catch {
      allowedOrigins = [];
    }
    const relayRaw =
      typeof body.RelayState === 'string' ? body.RelayState : null;
    const relay = sanitizeRelayState(relayRaw, allowedOrigins);
    if (relay && relay !== '/') return c.redirect(relay, 302);
    return c.json({
      engine: BRIVEN_ENGINE_ID,
      status: 'OK',
      userId: result.userId,
      email: result.email,
      projectId: result.projectId,
      tenantId: result.tenantId,
      sessionHandle: result.sessionHandle,
    });
  } catch (err) {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        code: 'saml_acs_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }
});

authCoreSsoRouter.get('/v1/auth-core/sso/oidc/:connectionId', async (c) => {
  try {
    const { redirectUrl } = await startOidcLogin(c.req.param('connectionId'));
    return c.redirect(redirectUrl, 302);
  } catch (err) {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        code: 'oidc_start_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }
});

authCoreSsoRouter.get(
  '/v1/auth-core/sso/oidc/:connectionId/callback',
  async (c) => {
    try {
      const code = c.req.query('code');
      const state = c.req.query('state');
      if (!code || !state) {
        return c.json(
          { engine: BRIVEN_ENGINE_ID, code: 'code_and_state_required' },
          400,
        );
      }
      const result = await completeOidcLogin({
        connectionId: c.req.param('connectionId'),
        code,
        state,
      });
      setCookie(c, 'sAccessToken', result.accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      });
      return c.json({
        engine: BRIVEN_ENGINE_ID,
        status: 'OK',
        userId: result.userId,
        email: result.email,
        projectId: result.projectId,
        tenantId: result.tenantId,
        sessionHandle: result.sessionHandle,
      });
    } catch (err) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'oidc_callback_failed',
          message: err instanceof Error ? err.message : String(err),
        },
        400,
      );
    }
  },
);
