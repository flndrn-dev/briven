import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { requireProjectAuth } from '../middleware/project-auth.js';
import { requireAuth } from '../middleware/session.js';
import { requireRecentMfa } from '../middleware/step-up.js';
import type { AppEnv } from '../types/app-env.js';
import { assertProjectRole } from '../services/access.js';
import { audit, hashIp, listAuditForProject } from '../services/audit.js';
import {
  getFunctionStats,
  getHourlyInvocations,
  listFunctionLogs,
  listFunctionNames,
} from '../services/function-logs.js';
import { getDefaultOrgForUser, isOrgMember, listOrgsForUser } from '../services/orgs.js';
import {
  createProject,
  getProjectForUser,
  getProjectInfo,
  listProjectsForUser,
  moveProjectToOrg,
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

// CLI- and SDK-facing routes accept a project-scoped API key (Bearer brk_…)
// in addition to a session / CLI JWT, via requireProjectAuth. Like /info
// above, they MUST be registered before the broad `/v1/projects/*`
// requireAuth so the session-only guard doesn't reject the API key first.
// The handlers themselves live in deploymentsRouter / invokeRouter; the
// requireProjectAuth here authenticates and sets apiKeyId, which the broad
// requireAuth below then honours (see session.ts). Without these carve-outs
// `briven deploy` and SDK function calls authenticated by API key 401 with
// "invalid cli token".
projectsRouter.use('/v1/projects/:id/schema/current', requireProjectAuth());
projectsRouter.use('/v1/projects/:id/deployments', requireProjectAuth());
projectsRouter.use('/v1/projects/:id/deployments/*', requireProjectAuth());
projectsRouter.use('/v1/projects/:id/functions/:name', requireProjectAuth());

// Project-scoped DATA routes (sprint S2.7). These live in their own routers
// (dbRouter, projectEnvRouter, logsRouter, usageRouter, exportRouter,
// studioRouter, aiRouter) and each already declares requireProjectAuth()
// + its own role check. But because the broad `/v1/projects/*` requireAuth()
// below is registered first (Hono runs matching middleware in registration
// order across mounted routers), a `brk_` API key was rejected by the
// session-only guard before those routers ran — so SDK/CLI calls 401'd on
// /env, /db/*, /logs/*, /usage, /export, /studio/*, /ai/*. Carving them out
// here authenticates the key first (session OR brk_); the broad requireAuth
// then honours the already-authenticated request (see session.ts). The per-
// route role checks (admin/developer) still run in the owning routers.
projectsRouter.use('/v1/projects/:id/env', requireProjectAuth());
projectsRouter.use('/v1/projects/:id/env/*', requireProjectAuth());
projectsRouter.use('/v1/projects/:id/db/*', requireProjectAuth());
projectsRouter.use('/v1/projects/:id/logs/*', requireProjectAuth());
projectsRouter.use('/v1/projects/:id/usage', requireProjectAuth());
projectsRouter.use('/v1/projects/:id/realtime-stats', requireProjectAuth());
projectsRouter.use('/v1/projects/:id/export', requireProjectAuth());
projectsRouter.use('/v1/projects/:id/studio/*', requireProjectAuth());
projectsRouter.use('/v1/projects/:id/ai/*', requireProjectAuth());
// Same carve-out for the storage / schedules / outbound-webhooks / webhooks
// surfaces — their owning routers (storageRouter, schedulesRouter, …) mount
// only requireAuth(), so without authenticating the brk_ key here first the
// broad `/v1/projects/*` requireAuth below rejects API-key calls with
// "invalid cli token". Each owning router still runs its own role check.
projectsRouter.use('/v1/projects/:id/files', requireProjectAuth());
projectsRouter.use('/v1/projects/:id/files/*', requireProjectAuth());
projectsRouter.use('/v1/projects/:id/schedules', requireProjectAuth());
projectsRouter.use('/v1/projects/:id/schedules/*', requireProjectAuth());
projectsRouter.use('/v1/projects/:id/outbound-webhooks', requireProjectAuth());
projectsRouter.use('/v1/projects/:id/outbound-webhooks/*', requireProjectAuth());
projectsRouter.use('/v1/projects/:id/webhooks', requireProjectAuth());
projectsRouter.use('/v1/projects/:id/webhooks/*', requireProjectAuth());

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

const moveSchema = z.object({
  orgId: z.string().min(1),
});

projectsRouter.post('/v1/projects/:id/move', async (c) => {
  const user = c.get('user')!;
  await assertProjectRole(c.req.param('id'), user.id, 'admin');
  const body = await c.req.json().catch(() => null);
  const parsed = moveSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  // The user must also belong to the target org — otherwise they could
  // "park" a project inside a team they have no business in.
  if (!(await isOrgMember(user.id, parsed.data.orgId))) {
    return c.json(
      { code: 'forbidden', message: 'you are not a member of the target org' },
      403,
    );
  }
  const project = await moveProjectToOrg({
    projectId: c.req.param('id'),
    userId: user.id,
    targetOrgId: parsed.data.orgId,
  });
  await audit({
    actorId: user.id,
    projectId: project.id,
    action: 'project.move',
    ipHash: getIpHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { newOrgId: parsed.data.orgId },
  });
  return c.json({ project });
});

// Project deletion requires step-up per CLAUDE.md §5.4 — a soft-delete
// kicks off the 30-day hard-delete grace window and is the kind of
// destructive action a stolen session shouldn't be able to perform
// without a fresh password prompt.
projectsRouter.delete('/v1/projects/:id', requireRecentMfa(10), async (c) => {
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

projectsRouter.get('/v1/projects/:id/function-logs', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  const functionName = c.req.query('function');
  const statusParam = c.req.query('status');
  const beforeParam = c.req.query('before');
  const limitParam = c.req.query('limit');

  const status = statusParam === 'ok' || statusParam === 'err' ? statusParam : undefined;
  let before: Date | undefined;
  if (beforeParam) {
    const d = new Date(beforeParam);
    if (!Number.isNaN(d.getTime())) before = d;
  }
  const limit = limitParam ? Number(limitParam) : undefined;

  const logs = await listFunctionLogs(project.id, {
    functionName: functionName && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(functionName)
      ? functionName
      : undefined,
    status,
    before,
    limit: Number.isFinite(limit) ? limit : undefined,
  });
  return c.json({ logs });
});

projectsRouter.get('/v1/projects/:id/function-names', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  const names = await listFunctionNames(project.id);
  return c.json({ names });
});

projectsRouter.get('/v1/projects/:id/hourly-invocations', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  const hours = await getHourlyInvocations(project.id);
  return c.json({ hours });
});

projectsRouter.get('/v1/projects/:id/function-stats', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  const fn = c.req.query('function');
  if (!fn || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(fn)) {
    return c.json({ code: 'validation_failed', message: 'expected ?function=name' }, 400);
  }
  const hoursParam = Number(c.req.query('hours') ?? '24');
  const hours = Number.isFinite(hoursParam) ? Math.min(Math.max(hoursParam, 1), 24 * 30) : 24;
  const stats = await getFunctionStats(project.id, fn, hours);
  return c.json({ ...stats, sinceHours: hours });
});

projectsRouter.get('/v1/projects/:id/activity', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  // Optional ?prefix=studio. filters audit rows by action prefix so the
  // activity page can drill into a single subsystem (studio, deploy, key).
  const prefix = c.req.query('prefix');
  const rows = await listAuditForProject(project.id, {
    limit: 100,
    actionPrefix: prefix && /^[a-z._]{1,32}$/.test(prefix) ? prefix : undefined,
  });
  return c.json({ activity: rows });
});
