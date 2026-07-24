/**
 * briven-engine M2M client credentials.
 *
 * Dashboard (session + project admin):
 *   GET/POST /v1/auth-core/projects/:projectId/m2m/clients
 *   DELETE   /v1/auth-core/projects/:projectId/m2m/clients/:clientId
 *
 * Public token endpoint (OAuth2 client_credentials):
 *   POST /v1/auth-core/oauth/token
 */

import { Hono } from 'hono';

import { requireAuthCoreProject } from '../middleware/auth-core-guard.js';
import { BRIVEN_ENGINE_ID } from '../services/auth-core/engine.js';
import {
  createM2mClient,
  isM2mRole,
  issueM2mToken,
  listM2mClients,
  revokeM2mClient,
  type M2mRole,
} from '../services/auth-core/m2m.js';
import type { AppEnv } from '../types/app-env.js';
import type { User } from '../middleware/session.js';

export const authCoreM2mRouter = new Hono<AppEnv>();

// ─── Dashboard: manage clients ───────────────────────────────────────

authCoreM2mRouter.use(
  '/v1/auth-core/projects/:projectId/m2m/clients',
  ...requireAuthCoreProject('admin'),
);
authCoreM2mRouter.use(
  '/v1/auth-core/projects/:projectId/m2m/clients/*',
  ...requireAuthCoreProject('admin'),
);

authCoreM2mRouter.get(
  '/v1/auth-core/projects/:projectId/m2m/clients',
  async (c) => {
    const projectId = c.req.param('projectId');
    try {
      const clients = await listM2mClients(projectId);
      return c.json({
        engine: BRIVEN_ENGINE_ID,
        projectId,
        clients: clients.map((cl) => ({
          id: cl.id,
          clientId: cl.clientId,
          name: cl.name,
          role: cl.role,
          hint: `…${cl.secretSuffix}`,
          revokedAt: cl.revokedAt,
          lastUsedAt: cl.lastUsedAt,
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

authCoreM2mRouter.post(
  '/v1/auth-core/projects/:projectId/m2m/clients',
  async (c) => {
    const projectId = c.req.param('projectId');
    let body: { name?: string; role?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    if (!body.name?.trim()) {
      return c.json(
        { engine: BRIVEN_ENGINE_ID, code: 'name_required', message: 'name required' },
        400,
      );
    }
    const role: M2mRole =
      body.role && isM2mRole(body.role) ? body.role : 'developer';
    const user = c.get('user') as User | null;
    try {
      const created = await createM2mClient({
        projectId,
        name: body.name,
        role,
        createdBy: user?.id ?? null,
      });
      return c.json({
        engine: BRIVEN_ENGINE_ID,
        projectId,
        client: {
          id: created.client.id,
          clientId: created.client.clientId,
          name: created.client.name,
          role: created.client.role,
          hint: `…${created.client.secretSuffix}`,
          /** Only once */
          clientSecret: created.clientSecret,
        },
        note: 'Copy client_id and client_secret now — secret is not shown again.',
        tokenUrl: `${(process.env.BRIVEN_API_ORIGIN ?? 'https://api.briven.tech').replace(/\/$/, '')}/v1/auth-core/oauth/token`,
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

authCoreM2mRouter.delete(
  '/v1/auth-core/projects/:projectId/m2m/clients/:clientId',
  async (c) => {
    const projectId = c.req.param('projectId');
    const clientId = c.req.param('clientId');
    try {
      await revokeM2mClient(projectId, clientId);
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

// ─── Public: OAuth2 token endpoint ───────────────────────────────────

/**
 * POST /v1/auth-core/oauth/token
 * grant_type=client_credentials
 * Accepts JSON or form body; optional HTTP Basic client_id:client_secret.
 */
authCoreM2mRouter.post('/v1/auth-core/oauth/token', async (c) => {
  let clientId = '';
  let clientSecret = '';
  let grantType = '';

  const auth = c.req.header('authorization');
  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const colon = decoded.indexOf(':');
      if (colon > 0) {
        clientId = decoded.slice(0, colon);
        clientSecret = decoded.slice(colon + 1);
      }
    } catch {
      // ignore — body may still provide credentials
    }
  }

  const ct = c.req.header('content-type') ?? '';
  if (ct.includes('application/x-www-form-urlencoded')) {
    const form = await c.req.parseBody();
    grantType = String(form.grant_type ?? '');
    if (!clientId) clientId = String(form.client_id ?? '');
    if (!clientSecret) clientSecret = String(form.client_secret ?? '');
  } else {
    let body: {
      grant_type?: string;
      client_id?: string;
      client_secret?: string;
    } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    grantType = body.grant_type ?? '';
    if (!clientId) clientId = body.client_id ?? '';
    if (!clientSecret) clientSecret = body.client_secret ?? '';
  }

  if (grantType !== 'client_credentials') {
    return c.json(
      {
        error: 'unsupported_grant_type',
        error_description: 'only client_credentials is supported',
        engine: BRIVEN_ENGINE_ID,
      },
      400,
    );
  }

  const result = await issueM2mToken({ clientId, clientSecret });
  if (!result.ok) {
    return c.json(
      {
        error: result.code,
        error_description: result.message,
        engine: BRIVEN_ENGINE_ID,
      },
      401,
    );
  }

  return c.json({
    access_token: result.accessToken,
    token_type: result.tokenType,
    expires_in: result.expiresIn,
    engine: BRIVEN_ENGINE_ID,
    project_id: result.projectId,
    client_id: result.clientId,
    role: result.role,
  });
});
