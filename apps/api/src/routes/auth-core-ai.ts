/**
 * AI agent token admin + verify (SuperTokens-class AI auth first cut).
 *
 * Dashboard (project admin):
 *   GET/POST /v1/auth-core/projects/:projectId/ai/agents
 *   DELETE   /v1/auth-core/projects/:projectId/ai/agents/:tokenId
 *
 * Public verify (Bearer brai_…):
 *   GET /v1/auth-core/ai/me
 */

import { Hono } from 'hono';

import { requireAuthCoreProject } from '../middleware/auth-core-guard.js';
import { BRIVEN_ENGINE_ID } from '../services/auth-core/engine.js';
import {
  createAiAgentToken,
  listAiAgentTokens,
  revokeAiAgentToken,
  verifyAiAgentToken,
} from '../services/auth-core/ai-auth.js';
import type { AppEnv } from '../types/app-env.js';
import type { User } from '../middleware/session.js';

export const authCoreAiRouter = new Hono<AppEnv>();

authCoreAiRouter.use(
  '/v1/auth-core/projects/:projectId/ai/agents',
  ...requireAuthCoreProject('admin'),
);
authCoreAiRouter.use(
  '/v1/auth-core/projects/:projectId/ai/agents/*',
  ...requireAuthCoreProject('admin'),
);

authCoreAiRouter.get(
  '/v1/auth-core/projects/:projectId/ai/agents',
  async (c) => {
    const projectId = c.req.param('projectId');
    try {
      const agents = await listAiAgentTokens(projectId);
      return c.json({ engine: BRIVEN_ENGINE_ID, projectId, agents });
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

authCoreAiRouter.post(
  '/v1/auth-core/projects/:projectId/ai/agents',
  async (c) => {
    const projectId = c.req.param('projectId');
    let body: { agentName?: string; scopes?: string[]; ttlHours?: number } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const user = c.get('user') as User | null;
    try {
      const created = await createAiAgentToken({
        projectId,
        agentName: body.agentName ?? 'agent',
        scopes: body.scopes,
        ttlHours: body.ttlHours,
        createdBy: user?.id ?? null,
      });
      return c.json({
        engine: BRIVEN_ENGINE_ID,
        projectId,
        agent: created.token,
        /** Shown once */
        plaintext: created.plaintext,
        note: 'Copy the token now — it is not shown again. Use Authorization: Bearer brai_…',
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

authCoreAiRouter.delete(
  '/v1/auth-core/projects/:projectId/ai/agents/:tokenId',
  async (c) => {
    const projectId = c.req.param('projectId');
    const tokenId = c.req.param('tokenId');
    try {
      await revokeAiAgentToken(projectId, tokenId);
      return c.json({ engine: BRIVEN_ENGINE_ID, ok: true, projectId, tokenId });
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

authCoreAiRouter.get('/v1/auth-core/ai/me', async (c) => {
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, authenticated: false, code: 'unauthorized' },
      401,
    );
  }
  const verified = await verifyAiAgentToken(token);
  if (!verified) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, authenticated: false, code: 'invalid_token' },
      401,
    );
  }
  return c.json({
    engine: BRIVEN_ENGINE_ID,
    authenticated: true,
    kind: 'ai_agent',
    ...verified,
  });
});
