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
  transitionDeployment,
} from '../services/deployments.js';
import { audit, hashIp } from '../services/audit.js';
import { applySchema, type SchemaDef } from '../services/schema-apply.js';
import { log } from '../lib/logger.js';

type AppEnv = {
  Variables: {
    user: User | null;
    session: Session | null;
    apiKeyId: string | null;
    requestId: string;
  };
};

const MAX_LIMIT = 100;

// Per-file source cap to keep a single deploy under ~25 MB even if every
// function maxes out. The full bundle column is then bounded by
// MAX_FUNCTION_FILES * MAX_FUNCTION_SOURCE_BYTES.
const MAX_FUNCTION_SOURCE_BYTES = 256 * 1024;
const MAX_FUNCTION_FILES = 100;

const createSchema = z.object({
  schemaDiffSummary: z.record(z.string(), z.unknown()).optional(),
  schemaSnapshot: z.record(z.string(), z.unknown()).optional(),
  functionCount: z.number().int().nonnegative().max(10_000).optional(),
  functionNames: z.array(z.string().max(128)).max(10_000).optional(),
  bundle: z
    .record(z.string().max(256), z.string().max(MAX_FUNCTION_SOURCE_BYTES))
    .refine((b) => Object.keys(b).length <= MAX_FUNCTION_FILES, {
      message: `bundle exceeds ${MAX_FUNCTION_FILES} files`,
    })
    .optional(),
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
    bundle: parsed.data.bundle,
  });

  await audit({
    actorId: user?.id ?? null,
    projectId,
    action: 'deployment.create',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { deploymentId: deployment.id, via: apiKeyId ? 'api_key' : 'session' },
  });

  // Apply the schema in-band. Phase 1 has one shared cluster + a single
  // worker — the api process is the worker. Phase 2 moves this onto a
  // queue so deploys don't block the request.
  if (parsed.data.schemaSnapshot) {
    try {
      await transitionDeployment({
        projectId,
        deploymentId: deployment.id,
        status: 'running',
      });
      const prev = await getCurrentSchema(projectId);
      await applySchema(
        projectId,
        deployment.id,
        parsed.data.schemaSnapshot as unknown as SchemaDef,
        (prev.snapshot as unknown as SchemaDef | null) ?? null,
      );
      await transitionDeployment({
        projectId,
        deploymentId: deployment.id,
        status: 'succeeded',
      });
    } catch (err) {
      log.error('schema_apply_failed', {
        projectId,
        deploymentId: deployment.id,
        message: err instanceof Error ? err.message : String(err),
      });
      await transitionDeployment({
        projectId,
        deploymentId: deployment.id,
        status: 'failed',
        errorCode: 'schema_apply_failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const updated = await getDeployment(projectId, deployment.id);
  return c.json({ deployment: updated }, 201);
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
