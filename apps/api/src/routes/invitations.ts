import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { env } from '../env.js';
import { memberRole } from '../db/schema.js';
import { projectRateLimit } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/session.js';
import type { AppEnv } from '../types/app-env.js';
import { assertProjectRole } from '../services/access.js';
import { audit, hashIp } from '../services/audit.js';
import {
  acceptInvitation,
  acceptInvitationById,
  createInvitation,
  listInvitations,
  pendingInvitationsForEmail,
  revokeInvitation,
} from '../services/invitations.js';

/**
 * Constrain a caller-supplied callback URL to the trusted web origin.
 * Validating it parses as a URL is NOT enough — `.startsWith(origin)` would
 * wrongly accept `https://briven.tech.evil.com`, so we compare the parsed
 * ORIGIN exactly. Closes the open-redirect on invite callbackURLs.
 */
function isTrustedWebRedirect(value: string): boolean {
  try {
    return new URL(value).origin === new URL(env.BRIVEN_WEB_ORIGIN).origin;
  } catch {
    return false;
  }
}

const createSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(memberRole),
  callbackURL: z
    .string()
    .url()
    .refine(isTrustedWebRedirect, 'callbackURL must be on the trusted web origin'),
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
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'admin');
  const rows = await listInvitations(project.id);
  return c.json({ invitations: rows });
});

invitationsRouter.post('/v1/projects/:id/invitations', projectRateLimit('mutate'), async (c) => {
  const user = c.get('user')!;
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'admin');
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

invitationsRouter.delete('/v1/projects/:id/invitations/:invitationId', projectRateLimit('mutate'), async (c) => {
  const user = c.get('user')!;
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'admin');
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
    metadata: { role: result.role, via: 'token' },
  });
  return c.json(result);
});

// why: accept-by-id replaces the token-based flow inside the dashboard.
// The recipient is already signed in with the matching email, which is
// itself proof of identity — exposing the one-time token in the listing
// API would defeat the model where the token is the email's second
// factor. The email-link flow above stays intact for not-yet-signed-in
// users who click straight from the inbox.
invitationsRouter.post('/v1/me/invitations/:invitationId/accept', async (c) => {
  const user = c.get('user')!;
  const invitationId = c.req.param('invitationId');
  if (!invitationId) {
    return c.json({ code: 'validation_failed', message: 'invitationId required' }, 400);
  }
  const result = await acceptInvitationById(user.id, user.email, invitationId);
  await audit({
    actorId: user.id,
    projectId: result.projectId,
    action: 'invitation.accept',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { role: result.role, via: 'dashboard' },
  });
  return c.json(result);
});
