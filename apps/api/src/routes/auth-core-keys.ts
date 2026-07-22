/**
 * briven-engine SDK keys API.
 *
 * Requires project admin (dashboard session or project API key).
 */

import { Hono } from 'hono';

import { requireAuthCoreProject } from '../middleware/auth-core-guard.js';
import { BRIVEN_ENGINE_ID } from '../services/auth-core/engine.js';
import {
  createAuthSdkKey,
  listAuthSdkKeysForProject,
  revokeAuthSdkKey,
} from '../services/auth-sdk-keys.js';
import type { AppEnv } from '../types/app-env.js';
import type { User } from '../middleware/session.js';

export const authCoreKeysRouter = new Hono<AppEnv>();

authCoreKeysRouter.use(
  '/v1/auth-core/projects/:projectId/keys',
  ...requireAuthCoreProject('admin'),
);
authCoreKeysRouter.use(
  '/v1/auth-core/projects/:projectId/keys/*',
  ...requireAuthCoreProject('admin'),
);

authCoreKeysRouter.get('/v1/auth-core/projects/:projectId/keys', async (c) => {
  const projectId = c.req.param('projectId');
  try {
    const keys = await listAuthSdkKeysForProject(projectId);
    return c.json({
      engine: BRIVEN_ENGINE_ID,
      projectId,
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        hint: `${k.prefix}…${k.suffix}`,
        scope: k.scope,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        expiresAt: k.expiresAt,
        revokedAt: k.revokedAt,
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
});

authCoreKeysRouter.post('/v1/auth-core/projects/:projectId/keys', async (c) => {
  const projectId = c.req.param('projectId');
  let body: { name?: string; scope?: string; createdBy?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!body.name?.trim()) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, code: 'name_required' },
      400,
    );
  }
  const user = c.get('user') as User | null;
  const createdBy = user?.id;
  if (!createdBy) {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        code: 'unauthorized',
        message: 'dashboard session required to mint keys',
      },
      401,
    );
  }
  try {
    const created = await createAuthSdkKey({
      projectId,
      createdBy,
      name: body.name,
      scope: (body.scope as 'read' | 'read-write' | 'admin') ?? 'read',
    });
    return c.json({
      engine: BRIVEN_ENGINE_ID,
      projectId,
      key: {
        id: created.record.id,
        name: created.record.name,
        scope: created.record.scope,
        hint: `${created.record.prefix}…${created.record.suffix}`,
        /** Only returned once at creation */
        plaintext: created.plaintext,
      },
      note: 'Copy the plaintext now — it is not shown again.',
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
});

authCoreKeysRouter.delete(
  '/v1/auth-core/projects/:projectId/keys/:keyId',
  async (c) => {
    const projectId = c.req.param('projectId');
    const keyId = c.req.param('keyId');
    try {
      await revokeAuthSdkKey(projectId, keyId);
      return c.json({
        engine: BRIVEN_ENGINE_ID,
        ok: true,
        projectId,
        keyId,
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
