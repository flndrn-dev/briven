import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { requireProjectAuth } from '../middleware/project-auth.js';
import { requireAuth } from '../middleware/session.js';
import type { AppEnv } from '../types/app-env.js';
import { assertProjectRole } from '../services/access.js';
import { audit, hashIp, listAuditForProject } from '../services/audit.js';
import { getDefaultOrgForUser, isOrgMember, listOrgsForUser } from '../services/orgs.js';
import {
  createProject,
  getProjectForUser,
  getProjectInfo,
  listProjectsForUser,
  softDeleteProjectForUser,
  updateProjectForUser,
} from '../services/projects.js';

const createSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(32).optional(),
  region: z.string().min(2).max(32).optional(),
  // Optional — when present, the project lands in this org. When
  // omitted, defaults to the user's personal org. We validate
  // membership before honouring the value (defense against an
  // attacker poking at other people's orgs).
  orgId: z.string().min(1).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  slug: z.string().min(1).max(32).optional(),
});

function getIpHash(c: Context<AppEnv>): string | null {
  const fwd = c.req.raw.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0]!.trim() : null;
  return hashIp(ip);
}

export const projectsRouter = new Hono<AppEnv>();

// The `/info` route below accepts either a session OR a project-scoped
// API key, via requireProjectAuth. It MUST be registered before the
// broader `/v1/projects/*` requireAuth middleware so the stricter
// session-only middleware doesn't short-circuit Bearer-authed requests
// to /info. Hono runs middleware in registration order.
projectsRouter.use('/v1/projects/:id/info', requireProjectAuth());
projectsRouter.get('/v1/projects/:id/info', async (c) => {
  // Lightweight "is this credential real?" endpoint — used by
  // `briven login` to verify the user's key before storing it.
  // Auth middleware has already validated the credential; we only
  // return a minimal info blob to confirm the project exists.
  const projectId = c.req.param('id');
  const info = await getProjectInfo(projectId);
  return c.json({ project: info });
});

projectsRouter.use('/v1/projects', requireAuth());
projectsRouter.use('/v1/projects/*', requireAuth());

projectsRouter.get('/v1/projects', async (c) => {
  const user = c.get('user')!;
  const [rows, orgs] = await Promise.all([
    listProjectsForUser(user.id),
    listOrgsForUser(user.id),
  ]);
  const orgsById = new Map(orgs.map((o) => [o.id, o]));
  // Enrich each project with its org name/personal flag so the
  // dashboard can show "p · personal" / "p · acme inc" without a
  // second round-trip.
  const enriched = rows.map((p) => {
    const org = orgsById.get(p.orgId);
    return {
      ...p,
      orgName: org?.name ?? null,
      orgPersonal: org?.personal ?? null,
    };
  });
  return c.json({ projects: enriched });
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

  // Resolve target org: when the caller passes an explicit orgId,
  // validate they belong to it; otherwise fall back to their personal
  // org (the legacy single-org behaviour).
  let targetOrgId: string;
  if (parsed.data.orgId) {
    const isMember = await isOrgMember(user.id, parsed.data.orgId);
    if (!isMember) {
      return c.json({ code: 'forbidden', message: 'not a member of that org' }, 403);
    }
    targetOrgId = parsed.data.orgId;
  } else {
    const org = await getDefaultOrgForUser(user.id);
    targetOrgId = org.id;
  }
  const project = await createProject({
    name: parsed.data.name,
    orgId: targetOrgId,
    createdByUserId: user.id,
    slug: parsed.data.slug,
    region: parsed.data.region,
  });
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
  await assertProjectRole(c.req.param('id'), user.id, 'admin');
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
  await assertProjectRole(c.req.param('id'), user.id, 'admin');
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
