import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { requireProjectAuth } from '../middleware/project-auth.js';
import type { Session, User } from '../middleware/session.js';
import {
  cancelPendingDeployment,
  createDeployment,
  getCurrentDeployment,
  getCurrentSchema,
  getDeployment,
  listDeploymentsForProject,
  transitionDeployment,
} from '../services/deployments.js';
import { audit, hashIp } from '../services/audit.js';
import { applySchema, type SchemaDef } from '../services/schema-apply.js';
import { assertFunctionCountAllowed } from '../services/tiers.js';
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
  return hashIp(ip);
}

export const deploymentsRouter = new Hono<AppEnv>();

deploymentsRouter.use('/v1/projects/:id/deployments', requireProjectAuth());
deploymentsRouter.use('/v1/projects/:id/deployments/*', requireProjectAuth());
deploymentsRouter.use('/v1/projects/:id/deployments/latest', requireProjectAuth());
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

  if (parsed.data.functionCount != null) {
    // Default free-tier cap. Once billing wires tier sync from Polar.sh,
    // this reads projects.tier / subscriptions.tier for the owning account.
    assertFunctionCountAllowed(parsed.data.functionCount, 'free');
  }

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

const patchSchema = z.object({
  changedFunctions: z
    .record(z.string().max(256), z.string().max(MAX_FUNCTION_SOURCE_BYTES))
    .optional(),
  removedFunctions: z.array(z.string().max(256)).optional(),
  schemaSnapshot: z.record(z.string(), z.unknown()).optional(),
  schemaDiffSummary: z.record(z.string(), z.unknown()).optional(),
  confirmDestructive: z.boolean().optional(),
});

deploymentsRouter.patch('/v1/projects/:id/deployments/latest', async (c) => {
  const projectId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
      400,
    );
  }

  const current = await getCurrentDeployment(projectId);
  const latestBundle = (current?.bundle as Record<string, string> | null) ?? {};

  const mergedBundle: Record<string, string> = { ...latestBundle };
  if (parsed.data.changedFunctions) {
    for (const [k, v] of Object.entries(parsed.data.changedFunctions)) mergedBundle[k] = v;
  }
  if (parsed.data.removedFunctions) {
    for (const k of parsed.data.removedFunctions) delete mergedBundle[k];
  }
  if (Object.keys(mergedBundle).length > MAX_FUNCTION_FILES) {
    return c.json(
      { code: 'bundle_too_large', message: `bundle exceeds ${MAX_FUNCTION_FILES} files` },
      400,
    );
  }

  // Schema snapshot: if the client didn't send one, inherit the previous;
  // destructive diffs are enforced when a new snapshot is supplied.
  const inheritedSnapshot =
    parsed.data.schemaSnapshot ??
    (current?.schemaSnapshot as Record<string, unknown> | null) ??
    undefined;

  if (parsed.data.schemaSnapshot && !parsed.data.confirmDestructive) {
    const prevSnap = (current?.schemaSnapshot as Record<string, unknown> | null) ?? null;
    if (isDestructiveDiff(prevSnap, parsed.data.schemaSnapshot)) {
      return c.json(
        {
          code: 'destructive_requires_confirmation',
          message:
            'schema diff drops tables or columns; re-send with confirmDestructive:true or run `briven deploy --confirm-destructive`',
        },
        400,
      );
    }
  }

  const user = c.get('user');
  const apiKeyId = c.get('apiKeyId');
  const functionNames = Object.keys(mergedBundle).sort();

  if (functionNames.length > 0) {
    assertFunctionCountAllowed(functionNames.length, 'free');
  }

  const deployment = await createDeployment({
    projectId,
    triggeredBy: user?.id ?? null,
    apiKeyId,
    schemaDiffSummary: parsed.data.schemaDiffSummary,
    schemaSnapshot: inheritedSnapshot,
    functionCount: functionNames.length,
    functionNames,
    bundle: mergedBundle,
  });

  await audit({
    actorId: user?.id ?? null,
    projectId,
    action: 'deployment.patch',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: {
      deploymentId: deployment.id,
      via: apiKeyId ? 'api_key' : 'session',
      changedCount: Object.keys(parsed.data.changedFunctions ?? {}).length,
      removedCount: parsed.data.removedFunctions?.length ?? 0,
    },
  });

  // Apply schema in-band (same path as POST /deployments). Harmless no-op
  // when the client didn't send a new snapshot.
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
  } else {
    // Function-only patches: no schema work, deployment is immediately
    // serve-able. Mark succeeded so getCurrentDeployment picks it up.
    await transitionDeployment({
      projectId,
      deploymentId: deployment.id,
      status: 'succeeded',
    });
  }

  const updated = await getDeployment(projectId, deployment.id);
  return c.json({ deployment: updated }, 201);
});

function isDestructiveDiff(
  prev: Record<string, unknown> | null,
  next: Record<string, unknown>,
): boolean {
  if (!prev) return false;
  const prevTables = (prev.tables as Record<string, Record<string, unknown>> | undefined) ?? {};
  const nextTables = (next.tables as Record<string, Record<string, unknown>> | undefined) ?? {};
  for (const tName of Object.keys(prevTables)) {
    if (!(tName in nextTables)) return true; // dropped table
    const prevCols = (prevTables[tName]!.columns as Record<string, unknown> | undefined) ?? {};
    const nextCols = (nextTables[tName]!.columns as Record<string, unknown> | undefined) ?? {};
    for (const cName of Object.keys(prevCols)) {
      if (!(cName in nextCols)) return true; // dropped column
    }
  }
  return false;
}

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
