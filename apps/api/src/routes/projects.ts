import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { env } from '../env.js';
import { requireAuth, type Session, type User } from '../middleware/session.js';
import { audit, hashIp, listAuditForProject } from '../services/audit.js';
import {
  createProject,
  getProjectForUser,
  listProjectsForUser,
  softDeleteProjectForUser,
  updateProjectForUser,
} from '../services/projects.js';

type AppEnv = {
  Variables: {
    user: User | null;
    session: Session | null;
    requestId: string;
  };
};

const createSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(32).optional(),
  region: z.string().min(2).max(32).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  slug: z.string().min(1).max(32).optional(),
});

function getIpHash(c: Context<AppEnv>): string | null {
  const fwd = c.req.raw.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0]!.trim() : null;
  const pepper = env.BRIVEN_BETTER_AUTH_SECRET ?? 'dev-pepper';
  return hashIp(ip, pepper);
}

export const projectsRouter = new Hono<AppEnv>();

projectsRouter.use('/v1/projects', requireAuth());
projectsRouter.use('/v1/projects/*', requireAuth());

projectsRouter.get('/v1/projects', async (c) => {
  const user = c.get('user')!;
  const rows = await listProjectsForUser(user.id);
  return c.json({ projects: rows });
});

projectsRouter.post('/v1/projects', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        code: 'validation_failed',
        message: 'invalid request body',
        issues: parsed.error.issues,
      },
      400,
    );
  }

  const project = await createProject({ ...parsed.data, ownerId: user.id });
  await audit({
    actorId: user.id,
    projectId: project.id,
    action: 'project.create',
    ipHash: getIpHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { slug: project.slug },
  });
  return c.json({ project }, 201);
});

projectsRouter.get('/v1/projects/:id', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  return c.json({ project });
});

projectsRouter.patch('/v1/projects/:id', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
      400,
    );
  }
  const project = await updateProjectForUser(c.req.param('id'), user.id, parsed.data);
  await audit({
    actorId: user.id,
    projectId: project.id,
    action: 'project.update',
    ipHash: getIpHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: parsed.data as Record<string, unknown>,
  });
  return c.json({ project });
});

projectsRouter.delete('/v1/projects/:id', async (c) => {
  const user = c.get('user')!;
  const project = await softDeleteProjectForUser(c.req.param('id'), user.id);
  await audit({
    actorId: user.id,
    projectId: project.id,
    action: 'project.delete',
    ipHash: getIpHash(c),
    userAgent: c.req.header('user-agent') ?? null,
  });
  return c.json({ project });
});

projectsRouter.get('/v1/projects/:id/activity', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  const rows = await listAuditForProject(project.id, 100);
  return c.json({ activity: rows });
});
