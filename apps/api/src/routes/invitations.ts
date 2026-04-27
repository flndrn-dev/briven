import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { memberRole } from '../db/schema.js';
import { requireAuth, type Session, type User } from '../middleware/session.js';
import { audit, hashIp } from '../services/audit.js';
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  pendingInvitationsForEmail,
  revokeInvitation,
} from '../services/invitations.js';
import { getProjectForUser } from '../services/projects.js';

type AppEnv = {
  Variables: {
    user: User | null;
    session: Session | null;
    requestId: string;
  };
};

const createSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(memberRole),
  callbackURL: z.string().url(),
});

const acceptSchema = z.object({
  token: z.string().min(10),
});

function ipHash(c: Context<AppEnv>): string | null {
  const fwd = c.req.raw.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0]!.trim() : null;
  return hashIp(ip);
}

export const invitationsRouter = new Hono<AppEnv>();

invitationsRouter.use('/v1/projects/:id/invitations', requireAuth());
invitationsRouter.use('/v1/projects/:id/invitations/*', requireAuth());
invitationsRouter.use('/v1/me/invitations', requireAuth());
invitationsRouter.use('/v1/me/invitations/*', requireAuth());

invitationsRouter.get('/v1/projects/:id/invitations', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  const rows = await listInvitations(project.id);
  return c.json({ invitations: rows });
});

invitationsRouter.post('/v1/projects/:id/invitations', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
      400,
    );
  }

  const invitation = await createInvitation({
    projectId: project.id,
    email: parsed.data.email,
    role: parsed.data.role,
    invitedBy: user.id,
    callbackURL: parsed.data.callbackURL,
  });

  await audit({
    actorId: user.id,
    projectId: project.id,
    action: 'invitation.create',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    // Never log the email itself — only the invitation id + role. §5.1.
    metadata: { invitationId: invitation.id, role: invitation.role },
  });
  return c.json({ invitation: { id: invitation.id, role: invitation.role } }, 201);
});

invitationsRouter.delete('/v1/projects/:id/invitations/:invitationId', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  const invitationId = c.req.param('invitationId');
  await revokeInvitation(project.id, invitationId);
  await audit({
    actorId: user.id,
    projectId: project.id,
    action: 'invitation.revoke',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { invitationId },
  });
  return c.json({ revoked: invitationId });
});

// —— recipient flows —————————————————————————————————————————

invitationsRouter.get('/v1/me/invitations', async (c) => {
  const user = c.get('user')!;
  const rows = await pendingInvitationsForEmail(user.email);
  return c.json({ invitations: rows });
});

invitationsRouter.post('/v1/me/invitations/accept', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
      400,
    );
  }
  const result = await acceptInvitation(user.id, user.email, parsed.data.token);
  await audit({
    actorId: user.id,
    projectId: result.projectId,
    action: 'invitation.accept',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { role: result.role },
  });
  return c.json(result);
});
