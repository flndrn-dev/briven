/**
 * SCIM 2.0 + admin token routes (Phase 9).
 *
 * Protocol (Bearer scim_briven_… only):
 *   /v1/projects/:id/scim/v2/*
 *
 * Admin (dashboard session, project admin):
 *   /v1/projects/:id/auth/scim/tokens
 */

import { Hono } from 'hono';

import { env } from '../env.js';
import { requireProjectAuth, requireProjectRole } from '../middleware/project-auth.js';
import { requireAuthTeamAdmin } from '../middleware/auth-team.js';
import { audit } from '../services/audit.js';
import {
  ScimError,
  createScimToken,
  listScimTokens,
  revokeScimToken,
  scimCreateGroup,
  scimCreateUser,
  scimDeleteGroup,
  scimDeleteUser,
  scimGetGroup,
  scimGetUser,
  scimListGroups,
  scimListUsers,
  scimPatchUser,
  scimReplaceUser,
  scimResourceTypes,
  scimServiceProviderConfig,
  verifyScimBearer,
} from '../services/auth-scim.js';
import type { ProjectAppEnv as AppEnv } from '../types/app-env.js';

export const authScimRouter = new Hono<AppEnv>();

function apiOrigin(): string {
  return env.BRIVEN_API_ORIGIN || 'https://api.briven.tech';
}

function bearerFrom(c: { req: { header: (n: string) => string | undefined } }): string | null {
  const h = c.req.header('authorization') ?? c.req.header('Authorization');
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

async function requireScimBearer(
  c: {
    req: { param: (n: string) => string; header: (n: string) => string | undefined };
    json: (body: unknown, status?: number) => Response;
  },
): Promise<{ projectId: string } | Response> {
  const projectId = c.req.param('id');
  if (!projectId) {
    return c.json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '400', detail: 'missing project id' }, 400);
  }
  const token = bearerFrom(c);
  const ok = await verifyScimBearer(projectId, token);
  if (!ok) {
    return c.json(
      {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '401',
        detail: 'invalid or missing SCIM bearer token',
      },
      401,
    );
  }
  return { projectId };
}

function scimCatch(err: unknown): Response {
  if (err instanceof ScimError) {
    return new Response(JSON.stringify(err.toJson()), {
      status: err.status,
      headers: { 'content-type': 'application/scim+json' },
    });
  }
  const message = err instanceof Error ? err.message : 'internal error';
  return new Response(
    JSON.stringify({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '500',
      detail: message,
    }),
    { status: 500, headers: { 'content-type': 'application/scim+json' } },
  );
}

function scimJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/scim+json' },
  });
}

// ─── Admin: SCIM tokens ────────────────────────────────────────────────────

authScimRouter.use('/v1/projects/:id/auth/scim/*', requireProjectAuth());
authScimRouter.use('/v1/projects/:id/auth/scim/*', requireAuthTeamAdmin());

authScimRouter.get(
  '/v1/projects/:id/auth/scim/tokens',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const items = await listScimTokens(projectId);
    return c.json({ items });
  },
);

authScimRouter.post(
  '/v1/projects/:id/auth/scim/tokens',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
    if (!body || typeof body.name !== 'string') {
      return c.json({ code: 'validation_failed', message: 'name required' }, 400);
    }
    try {
      const created = await createScimToken(projectId, body.name);
      await audit({
        actorId: actor.id,
        projectId,
        action: 'briven_auth.scim_token.created',
        metadata: { tokenId: created.id, suffix: created.suffix },
      });
      return c.json(
        {
          id: created.id,
          name: created.name,
          prefix: created.prefix,
          suffix: created.suffix,
          createdAt: created.createdAt,
          plaintext: created.plaintext,
        },
        201,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'create failed';
      return c.json({ code: 'validation_failed', message }, 400);
    }
  },
);

authScimRouter.delete(
  '/v1/projects/:id/auth/scim/tokens/:tokenId',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const tokenId = c.req.param('tokenId');
    const actor = c.get('user');
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    try {
      await revokeScimToken(projectId, tokenId);
      await audit({
        actorId: actor.id,
        projectId,
        action: 'briven_auth.scim_token.revoked',
        metadata: { tokenId },
      });
      return c.json({ ok: true });
    } catch {
      return c.json({ code: 'not_found' }, 404);
    }
  },
);

// ─── SCIM protocol ─────────────────────────────────────────────────────────

authScimRouter.get('/v1/projects/:id/scim/v2/ServiceProviderConfig', async (c) => {
  const gate = await requireScimBearer(c);
  if (gate instanceof Response) return gate;
  return scimJson(scimServiceProviderConfig());
});

authScimRouter.get('/v1/projects/:id/scim/v2/ResourceTypes', async (c) => {
  const gate = await requireScimBearer(c);
  if (gate instanceof Response) return gate;
  return scimJson(scimResourceTypes(gate.projectId, apiOrigin()));
});

authScimRouter.get('/v1/projects/:id/scim/v2/Schemas', async (c) => {
  const gate = await requireScimBearer(c);
  if (gate instanceof Response) return gate;
  return scimJson({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: 2,
    Resources: [
      { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User' },
      { id: 'urn:ietf:params:scim:schemas:core:2.0:Group', name: 'Group' },
    ],
  });
});

authScimRouter.get('/v1/projects/:id/scim/v2/Users', async (c) => {
  const gate = await requireScimBearer(c);
  if (gate instanceof Response) return gate;
  try {
    const startIndex = Number(c.req.query('startIndex') ?? '1');
    const count = Number(c.req.query('count') ?? '100');
    const filter = c.req.query('filter') ?? undefined;
    const list = await scimListUsers(
      gate.projectId,
      { filter, startIndex, count },
      apiOrigin(),
    );
    return scimJson(list);
  } catch (err) {
    return scimCatch(err);
  }
});

authScimRouter.post('/v1/projects/:id/scim/v2/Users', async (c) => {
  const gate = await requireScimBearer(c);
  if (gate instanceof Response) return gate;
  try {
    const body = await c.req.json();
    const user = await scimCreateUser(gate.projectId, body, apiOrigin());
    return scimJson(user, 201);
  } catch (err) {
    return scimCatch(err);
  }
});

authScimRouter.get('/v1/projects/:id/scim/v2/Users/:userId', async (c) => {
  const gate = await requireScimBearer(c);
  if (gate instanceof Response) return gate;
  try {
    const user = await scimGetUser(gate.projectId, c.req.param('userId'), apiOrigin());
    return scimJson(user);
  } catch (err) {
    return scimCatch(err);
  }
});

authScimRouter.put('/v1/projects/:id/scim/v2/Users/:userId', async (c) => {
  const gate = await requireScimBearer(c);
  if (gate instanceof Response) return gate;
  try {
    const body = await c.req.json();
    const user = await scimReplaceUser(gate.projectId, c.req.param('userId'), body, apiOrigin());
    return scimJson(user);
  } catch (err) {
    return scimCatch(err);
  }
});

authScimRouter.patch('/v1/projects/:id/scim/v2/Users/:userId', async (c) => {
  const gate = await requireScimBearer(c);
  if (gate instanceof Response) return gate;
  try {
    const body = await c.req.json();
    const user = await scimPatchUser(gate.projectId, c.req.param('userId'), body, apiOrigin());
    return scimJson(user);
  } catch (err) {
    return scimCatch(err);
  }
});

authScimRouter.delete('/v1/projects/:id/scim/v2/Users/:userId', async (c) => {
  const gate = await requireScimBearer(c);
  if (gate instanceof Response) return gate;
  try {
    await scimDeleteUser(gate.projectId, c.req.param('userId'));
    return new Response(null, { status: 204 });
  } catch (err) {
    return scimCatch(err);
  }
});

authScimRouter.get('/v1/projects/:id/scim/v2/Groups', async (c) => {
  const gate = await requireScimBearer(c);
  if (gate instanceof Response) return gate;
  try {
    const startIndex = Number(c.req.query('startIndex') ?? '1');
    const count = Number(c.req.query('count') ?? '100');
    const list = await scimListGroups(gate.projectId, { startIndex, count }, apiOrigin());
    return scimJson(list);
  } catch (err) {
    return scimCatch(err);
  }
});

authScimRouter.post('/v1/projects/:id/scim/v2/Groups', async (c) => {
  const gate = await requireScimBearer(c);
  if (gate instanceof Response) return gate;
  try {
    const body = await c.req.json();
    const group = await scimCreateGroup(gate.projectId, body, apiOrigin());
    return scimJson(group, 201);
  } catch (err) {
    return scimCatch(err);
  }
});

authScimRouter.get('/v1/projects/:id/scim/v2/Groups/:groupId', async (c) => {
  const gate = await requireScimBearer(c);
  if (gate instanceof Response) return gate;
  try {
    const group = await scimGetGroup(gate.projectId, c.req.param('groupId'), apiOrigin());
    return scimJson(group);
  } catch (err) {
    return scimCatch(err);
  }
});

authScimRouter.delete('/v1/projects/:id/scim/v2/Groups/:groupId', async (c) => {
  const gate = await requireScimBearer(c);
  if (gate instanceof Response) return gate;
  try {
    await scimDeleteGroup(gate.projectId, c.req.param('groupId'));
    return new Response(null, { status: 204 });
  } catch (err) {
    return scimCatch(err);
  }
});
