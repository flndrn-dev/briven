import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { env } from '../env.js';
import { requireProjectAuth } from '../middleware/project-auth.js';
import type { Session, User } from '../middleware/session.js';
import {
  cancelPendingDeployment,
  createDeployment,
  getCurrentSchema,
  getDeployment,
  listDeploymentsForProject,
} from '../services/deployments.js';
import { audit, hashIp } from '../services/audit.js';

type AppEnv = {
  Variables: {
    user: User | null;
    session: Session | null;
    apiKeyId: string | null;
    requestId: string;
  };
};

const MAX_LIMIT = 100;

const createSchema = z.object({
  schemaDiffSummary: z.record(z.string(), z.unknown()).optional(),
  schemaSnapshot: z.record(z.string(), z.unknown()).optional(),
  functionCount: z.number().int().nonnegative().max(10_000).optional(),
  functionNames: z.array(z.string().max(128)).max(10_000).optional(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(50),
});

function ipHash(c: Context<AppEnv>): string | null {
  const fwd = c.req.raw.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0]!.trim() : null;
  const pepper = env.BRIVEN_BETTER_AUTH_SECRET ?? 'dev-pepper';
  return hashIp(ip, pepper);
}

export const deploymentsRouter = new Hono<AppEnv>();

deploymentsRouter.use('/v1/projects/:id/deployments', requireProjectAuth());
deploymentsRouter.use('/v1/projects/:id/deployments/*', requireProjectAuth());
deploymentsRouter.use('/v1/projects/:id/info', requireProjectAuth());
deploymentsRouter.use('/v1/projects/:id/schema/current', requireProjectAuth());

deploymentsRouter.get('/v1/projects/:id/schema/current', async (c) => {
  const current = await getCurrentSchema(c.req.param('id'));
  return c.json(current);
});

deploymentsRouter.get('/v1/projects/:id/info', async (c) => {
  const user = c.get('user');
  const apiKeyId = c.get('apiKeyId');
  // Intentionally omit user.email per CLAUDE.md §5.1 — the /v1/me endpoint
  // is the only place a user's own email surfaces, and only to themselves.
  return c.json({
    projectId: c.req.param('id'),
    authenticatedVia: apiKeyId ? 'api_key' : 'session',
    apiKeyId,
    userId: user?.id ?? null,
  });
});

deploymentsRouter.get('/v1/projects/:id/deployments', async (c) => {
  const parsed = listQuerySchema.safeParse({
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid query', issues: parsed.error.issues },
      400,
    );
  }
  const rows = await listDeploymentsForProject(c.req.param('id'), parsed.data.limit);
  return c.json({ deployments: rows });
});

deploymentsRouter.post('/v1/projects/:id/deployments', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
      400,
    );
  }

  const projectId = c.req.param('id');
  const user = c.get('user');
  const apiKeyId = c.get('apiKeyId');

  const deployment = await createDeployment({
    projectId,
    triggeredBy: user?.id ?? null,
    apiKeyId,
    schemaDiffSummary: parsed.data.schemaDiffSummary,
    schemaSnapshot: parsed.data.schemaSnapshot,
    functionCount: parsed.data.functionCount,
    functionNames: parsed.data.functionNames,
  });

  await audit({
    actorId: user?.id ?? null,
    projectId,
    action: 'deployment.create',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { deploymentId: deployment.id, via: apiKeyId ? 'api_key' : 'session' },
  });

  return c.json({ deployment }, 201);
});

deploymentsRouter.get('/v1/projects/:id/deployments/:deploymentId', async (c) => {
  const deployment = await getDeployment(c.req.param('id'), c.req.param('deploymentId'));
  return c.json({ deployment });
});

deploymentsRouter.post('/v1/projects/:id/deployments/:deploymentId/cancel', async (c) => {
  const projectId = c.req.param('id');
  const deploymentId = c.req.param('deploymentId');
  const deployment = await cancelPendingDeployment(projectId, deploymentId);
  const user = c.get('user');

  await audit({
    actorId: user?.id ?? null,
    projectId,
    action: 'deployment.cancel',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { deploymentId },
  });

  return c.json({ deployment });
});
