import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { env } from '../env.js';
import { requireAuth, type Session, type User } from '../middleware/session.js';
import { audit, hashIp } from '../services/audit.js';
import {
  addMemberByEmail,
  listMembers,
  removeMember,
  requireMemberRole,
  updateMemberRole,
} from '../services/members.js';
import { getProjectForUser } from '../services/projects.js';
import { memberRole } from '../db/schema.js';

type AppEnv = {
  Variables: {
    user: User | null;
    session: Session | null;
    requestId: string;
  };
};

const roleSchema = z.enum(memberRole);

const addMemberSchema = z.object({
  email: z.string().email().max(320),
  role: roleSchema,
});

const updateMemberSchema = z.object({
  role: roleSchema,
});

function ipHash(c: Context<AppEnv>): string | null {
  const fwd = c.req.raw.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0]!.trim() : null;
  const pepper = env.BRIVEN_BETTER_AUTH_SECRET ?? 'dev-pepper';
  return hashIp(ip, pepper);
}

export const membersRouter = new Hono<AppEnv>();

membersRouter.use('/v1/projects/:id/members', requireAuth());
membersRouter.use('/v1/projects/:id/members/*', requireAuth());

membersRouter.get('/v1/projects/:id/members', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  const rows = await listMembers(project.id);
  return c.json({ members: rows });
});

membersRouter.post('/v1/projects/:id/members', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  await requireMemberRole(project.id, user.id, 'admin');

  const body = await c.req.json().catch(() => null);
  const parsed = addMemberSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
      400,
    );
  }

  const member = await addMemberByEmail({
    projectId: project.id,
    email: parsed.data.email,
    role: parsed.data.role,
  });

  await audit({
    actorId: user.id,
    projectId: project.id,
    action: 'member.add',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    // Per CLAUDE.md §5.1 we do not log email addresses; record the target
    // user id instead.
    metadata: { userId: member.userId, role: member.role },
  });

  return c.json({ member }, 201);
});

membersRouter.patch('/v1/projects/:id/members/:userId', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  await requireMemberRole(project.id, user.id, 'admin');

  const body = await c.req.json().catch(() => null);
  const parsed = updateMemberSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
      400,
    );
  }

  const targetId = c.req.param('userId');
  const member = await updateMemberRole(project.id, targetId, parsed.data.role);

  await audit({
    actorId: user.id,
    projectId: project.id,
    action: 'member.update_role',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { userId: targetId, role: parsed.data.role },
  });

  return c.json({ member });
});

membersRouter.delete('/v1/projects/:id/members/:userId', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  await requireMemberRole(project.id, user.id, 'admin');

  const targetId = c.req.param('userId');
  await removeMember(project.id, targetId);

  await audit({
    actorId: user.id,
    projectId: project.id,
    action: 'member.remove',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { userId: targetId },
  });

  return c.json({ removed: targetId });
});
