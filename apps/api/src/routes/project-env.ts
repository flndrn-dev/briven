import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { rateLimit } from '../middleware/rate-limit.js';
import { requireProjectAuth } from '../middleware/project-auth.js';
import type { Session, User } from '../middleware/session.js';
import { audit, hashIp } from '../services/audit.js';
import {
  deleteEnvVar,
  deleteEnvVarByKey,
  getPlainEnvForProject,
  listEnvForProject,
  upsertEnvVar,
} from '../services/project-env.js';

type AppEnv = {
  Variables: {
    user: User | null;
    session: Session | null;
    apiKeyId: string | null;
    requestId: string;
  };
};

const putSchema = z.object({
  key: z.string().min(1).max(64),
  value: z.string().max(32_768),
});

function ipHash(c: Context<AppEnv>): string | null {
  const fwd = c.req.raw.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0]!.trim() : null;
  return hashIp(ip);
}

export const projectEnvRouter = new Hono<AppEnv>();

projectEnvRouter.use('/v1/projects/:id/env', requireProjectAuth());
projectEnvRouter.use('/v1/projects/:id/env/*', requireProjectAuth());

projectEnvRouter.get('/v1/projects/:id/env', async (c) => {
  const vars = await listEnvForProject(c.req.param('id'));
  return c.json({ env: vars });
});

projectEnvRouter.put('/v1/projects/:id/env', async (c) => {
  const projectId = c.req.param('id');
  const user = c.get('user');
  const apiKeyId = c.get('apiKeyId');
  const body = await c.req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
      400,
    );
  }
  await upsertEnvVar({
    projectId,
    key: parsed.data.key,
    value: parsed.data.value,
    createdBy: user?.id ?? null,
  });
  await audit({
    actorId: user?.id ?? null,
    projectId,
    action: 'env.upsert',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    // why: key is useful for audit review; value is never logged per CLAUDE.md §5.1.
    metadata: { key: parsed.data.key, via: apiKeyId ? 'api_key' : 'session' },
  });
  return c.json({ key: parsed.data.key });
});

projectEnvRouter.delete('/v1/projects/:id/env/:envVarId', async (c) => {
  const projectId = c.req.param('id');
  const envVarId = c.req.param('envVarId');
  // Guard against the by-key path shadowing this one — by-key is mounted
  // explicitly below on a distinct `/env/by-key/:key` path.
  if (envVarId === 'by-key' || envVarId === 'plaintext') {
    return c.json({ code: 'not_found', message: 'route not found' }, 404);
  }
  const user = c.get('user');
  const apiKeyId = c.get('apiKeyId');
  await deleteEnvVar(projectId, envVarId);
  await audit({
    actorId: user?.id ?? null,
    projectId,
    action: 'env.delete',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { envVarId, via: apiKeyId ? 'api_key' : 'session' },
  });
  return c.json({ deleted: envVarId });
});

projectEnvRouter.delete('/v1/projects/:id/env/by-key/:key', async (c) => {
  const projectId = c.req.param('id');
  const key = c.req.param('key');
  const user = c.get('user');
  const apiKeyId = c.get('apiKeyId');
  const deleted = await deleteEnvVarByKey(projectId, key);
  await audit({
    actorId: user?.id ?? null,
    projectId,
    action: 'env.delete',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { key, via: apiKeyId ? 'api_key' : 'session' },
  });
  return c.json({ deleted: deleted.id, key });
});

// why: plaintext reads are the single high-signal audit target for this
// resource. 10/min per project is generous for humans, restrictive enough
// to slow a leaked-credential scrape.
projectEnvRouter.get(
  '/v1/projects/:id/env/plaintext',
  rateLimit({
    scope: 'env-pull',
    limit: 10,
    windowMs: 60_000,
    key: (c) => c.req.param('id') ?? null,
  }),
  async (c) => {
    const projectId = c.req.param('id');
    const user = c.get('user');
    const apiKeyId = c.get('apiKeyId');
    const plain = await getPlainEnvForProject(projectId);
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'env.pull',
      ipHash: ipHash(c),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { count: Object.keys(plain).length, via: apiKeyId ? 'api_key' : 'session' },
    });
    return c.json({ env: plain });
  },
);
