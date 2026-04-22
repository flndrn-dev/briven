import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { env } from '../env.js';
import { requireAuth, type Session, type User } from '../middleware/session.js';
import { audit, hashIp } from '../services/audit.js';
import { deleteEnvVar, listEnvForProject, upsertEnvVar } from '../services/project-env.js';
import { getProjectForUser } from '../services/projects.js';

type AppEnv = {
  Variables: {
    user: User | null;
    session: Session | null;
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
  const pepper = env.BRIVEN_BETTER_AUTH_SECRET ?? 'dev-pepper';
  return hashIp(ip, pepper);
}

export const projectEnvRouter = new Hono<AppEnv>();

projectEnvRouter.use('/v1/projects/:id/env', requireAuth());
projectEnvRouter.use('/v1/projects/:id/env/*', requireAuth());

projectEnvRouter.get('/v1/projects/:id/env', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  const vars = await listEnvForProject(project.id);
  return c.json({ env: vars });
});

projectEnvRouter.put('/v1/projects/:id/env', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  const body = await c.req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
      400,
    );
  }
  await upsertEnvVar({
    projectId: project.id,
    key: parsed.data.key,
    value: parsed.data.value,
    createdBy: user.id,
  });
  await audit({
    actorId: user.id,
    projectId: project.id,
    action: 'env.upsert',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    // Log the key but never the value.
    metadata: { key: parsed.data.key },
  });
  return c.json({ key: parsed.data.key });
});

projectEnvRouter.delete('/v1/projects/:id/env/:envVarId', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  const envVarId = c.req.param('envVarId');
  await deleteEnvVar(project.id, envVarId);
  await audit({
    actorId: user.id,
    projectId: project.id,
    action: 'env.delete',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { envVarId },
  });
  return c.json({ deleted: envVarId });
});
