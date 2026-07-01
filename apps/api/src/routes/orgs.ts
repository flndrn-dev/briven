import { Hono } from 'hono';
import { z } from 'zod';

import { newId } from '@briven/shared';

import { userRateLimit } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/session.js';
import type { AppEnv } from '../types/app-env.js';
import { audit, hashIp } from '../services/audit.js';
import {
  canUserCreateAnotherOrg,
  changeOrgMemberRole,
  createOrg,
  deleteOrg,
  getDefaultOrgForUser,
  isOrgMember,
  listOrgMembers,
  listOrgsForUser,
  promotePersonalOrgToTeam,
  removeOrgMember,
  renameOrg,
} from '../services/orgs.js';
import {
  acceptOrgInvitation,
  createOrgInvitation,
  listOrgInvitations,
  pendingOrgInvitationsForEmail,
  revokeOrgInvitation,
} from '../services/org-invitations.js';
import { getTierForOrg } from '../services/billing.js';
import { orgRole } from '../db/schema.js';

/**
 * Multi-org surface — team creation + list. Personal orgs are auto-
 * created by the user.create.after Better Auth hook and never appear
 * in the "new team" form; team orgs are explicit and listed here so
 * the dashboard's /dashboard/teams can render them.
 */

export const orgsRouter = new Hono<AppEnv>();

orgsRouter.use('/v1/me/orgs', requireAuth());
orgsRouter.use('/v1/orgs', requireAuth());

/**
 * List every org the signed-in user is a member of — both the personal
 * org and any team orgs they've created or been added to. Each row
 * carries a `personal` flag so the UI can group "personal" separately
 * from team orgs.
 */
orgsRouter.get('/v1/me/orgs', async (c) => {
  const user = c.get('user')!;
  const orgs = await listOrgsForUser(user.id);
  return c.json({
    orgs: orgs.map((o) => ({
      id: o.id,
      slug: o.slug,
      name: o.name,
      personal: o.personal,
      createdAt: o.createdAt,
    })),
  });
});

const createSchema = z.object({
  name: z.string().min(2).max(200),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/u, 'slug must be kebab-case, 2-40 chars')
    .optional(),
});

/**
 * Create a new team org. The creator becomes its owner. Free tier caps
 * teams per user at 1 (one personal + one team); Pro at 5; Team at
 * unlimited — but enforcement of those caps is a follow-up. Today the
 * platform just creates the row.
 */
orgsRouter.post('/v1/orgs', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }

  // Tier-cap check — free users can't create team orgs (limit=1 owned;
  // their personal org already takes that slot). Pro users get 3 owned
  // orgs total. Team-tier is unlimited. Tier is resolved from the user's
  // personal org since teams don't carry their own subscription yet.
  const personal = await getDefaultOrgForUser(user.id);
  const tier = await getTierForOrg(personal.id);
  const gate = await canUserCreateAnotherOrg(user.id, tier);
  if (!gate.allowed) {
    return c.json(
      {
        code: 'team_limit_reached',
        message: gate.reason,
        upgradeURL: '/dashboard/billing/upgrade',
      },
      402,
    );
  }
  const slug =
    parsed.data.slug ??
    `${parsed.data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 32)}-${newId('org').slice(-6).toLowerCase()}`;
  const org = await createOrg({
    createdBy: user.id,
    name: parsed.data.name,
    slug,
    personal: false,
    role: 'owner',
  });
  await audit({
    actorId: user.id,
    projectId: null,
    action: 'org.created',
    ipHash: hashIp(c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { orgId: org.id, slug: org.slug, name: org.name },
  });
  return c.json({
    org: {
      id: org.id,
      slug: org.slug,
      name: org.name,
      personal: org.personal,
      createdAt: org.createdAt,
    },
  });
});

const renameSchema = z.object({
  name: z.string().min(2).max(200),
});

orgsRouter.use('/v1/orgs/:id', requireAuth());

orgsRouter.patch('/v1/orgs/:id', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = renameSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const updated = await renameOrg({
    orgId,
    userId: user.id,
    name: parsed.data.name,
  });
  if (!updated) {
    return c.json(
      {
        code: 'not_found_or_not_writable',
        message: 'org not found, not a member, or it is a personal org',
      },
      404,
    );
  }
  await audit({
    actorId: user.id,
    projectId: null,
    action: 'org.renamed',
    ipHash: hashIp(c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { orgId, newName: updated.name },
  });
  return c.json({
    org: {
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
      personal: updated.personal,
    },
  });
});

const promoteSchema = z.object({
  name: z.string().min(1).max(120),
});

/**
 * Promote a personal org to a real team. Personal orgs are
 * single-member by default; graduating one unlocks the rest of the
 * team affordances (rename via the standard patch route, invite
 * members, ...). The caller must be an owner of the org being
 * promoted — the service enforces that, the route just shapes the
 * request + records audit.
 */
orgsRouter.post('/v1/orgs/:id/promote', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = promoteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const result = await promotePersonalOrgToTeam({
    orgId,
    userId: user.id,
    name: parsed.data.name,
  });
  if (!result.ok) {
    const status = result.reason === 'org_not_found' ? 404 : 400;
    return c.json({ code: 'cannot_promote', reason: result.reason }, status);
  }
  await audit({
    actorId: user.id,
    projectId: null,
    action: 'org.promoted',
    ipHash: hashIp(c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { orgId, newName: result.org.name },
  });
  return c.json({
    org: {
      id: result.org.id,
      slug: result.org.slug,
      name: result.org.name,
      personal: result.org.personal,
    },
  });
});

orgsRouter.delete('/v1/orgs/:id', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('id');
  const result = await deleteOrg({ orgId, userId: user.id });
  if (!result.ok) {
    return c.json({ code: 'cannot_delete_org', message: result.reason }, 400);
  }
  await audit({
    actorId: user.id,
    projectId: null,
    action: 'org.deleted',
    ipHash: hashIp(c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { orgId },
  });
  return c.json({ deleted: orgId });
});

/* ─── org members ─────────────────────────────────────────────────── */

orgsRouter.use('/v1/orgs/:id/members', requireAuth());
orgsRouter.use('/v1/orgs/:id/members/*', requireAuth());

orgsRouter.get('/v1/orgs/:id/members', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('id');
  if (!(await isOrgMember(user.id, orgId))) {
    return c.json({ code: 'forbidden', message: 'not a member of that org' }, 403);
  }
  const members = await listOrgMembers(orgId);
  return c.json({ members });
});

const changeRoleSchema = z.object({
  role: z.enum(orgRole),
});

orgsRouter.patch('/v1/orgs/:id/members/:userId', userRateLimit('org-mutate', 30), async (c) => {
  const actor = c.get('user')!;
  const orgId = c.req.param('id');
  const targetUserId = c.req.param('userId');
  if (!(await isOrgMember(actor.id, orgId))) {
    return c.json({ code: 'forbidden', message: 'not a member of that org' }, 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = changeRoleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const result = await changeOrgMemberRole({
    orgId,
    userId: targetUserId,
    newRole: parsed.data.role,
  });
  if (!result.ok) {
    return c.json({ code: 'cannot_change_role', message: result.reason }, 400);
  }
  await audit({
    actorId: actor.id,
    projectId: null,
    action: 'org.member.role_changed',
    ipHash: hashIp(c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { orgId, userId: targetUserId, newRole: parsed.data.role },
  });
  return c.json({ ok: true, role: parsed.data.role });
});

orgsRouter.delete('/v1/orgs/:id/members/:userId', userRateLimit('org-mutate', 30), async (c) => {
  const actor = c.get('user')!;
  const orgId = c.req.param('id');
  const targetUserId = c.req.param('userId');
  if (!(await isOrgMember(actor.id, orgId))) {
    return c.json({ code: 'forbidden', message: 'not a member of that org' }, 403);
  }
  const result = await removeOrgMember({ orgId, userId: targetUserId });
  if (!result.removed) {
    return c.json({ code: 'cannot_remove_member', message: result.reason }, 400);
  }
  await audit({
    actorId: actor.id,
    projectId: null,
    action: 'org.member.removed',
    ipHash: hashIp(c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { orgId, removedUserId: targetUserId },
  });
  return c.json({ removed: targetUserId });
});

/* ─── org invitations ─────────────────────────────────────────────── */

orgsRouter.use('/v1/orgs/:id/invitations', requireAuth());
orgsRouter.use('/v1/orgs/:id/invitations/*', requireAuth());
orgsRouter.use('/v1/me/org-invitations', requireAuth());
orgsRouter.use('/v1/org-invitations/accept', requireAuth());

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(orgRole).default('developer'),
  callbackURL: z.string().url(),
});

orgsRouter.get('/v1/orgs/:id/invitations', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('id');
  if (!(await isOrgMember(user.id, orgId))) {
    return c.json({ code: 'forbidden', message: 'not a member of that org' }, 403);
  }
  const rows = await listOrgInvitations(orgId);
  return c.json({
    invitations: rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      expiresAt: r.expiresAt,
      acceptedAt: r.acceptedAt,
      revokedAt: r.revokedAt,
      createdAt: r.createdAt,
    })),
  });
});

orgsRouter.post('/v1/orgs/:id/invitations', userRateLimit('org-mutate', 30), async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('id');
  if (!(await isOrgMember(user.id, orgId))) {
    return c.json({ code: 'forbidden', message: 'not a member of that org' }, 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const inv = await createOrgInvitation({
    orgId,
    email: parsed.data.email,
    role: parsed.data.role,
    invitedBy: user.id,
    callbackURL: parsed.data.callbackURL,
  });
  await audit({
    actorId: user.id,
    projectId: null,
    action: 'org.invitation.created',
    ipHash: hashIp(c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { orgId, email: parsed.data.email, role: parsed.data.role },
  });
  return c.json({
    invitation: {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      expiresAt: inv.expiresAt,
    },
  });
});

orgsRouter.delete('/v1/orgs/:id/invitations/:invId', userRateLimit('org-mutate', 30), async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('id');
  const invId = c.req.param('invId');
  if (!(await isOrgMember(user.id, orgId))) {
    return c.json({ code: 'forbidden', message: 'not a member of that org' }, 403);
  }
  await revokeOrgInvitation(orgId, invId);
  await audit({
    actorId: user.id,
    projectId: null,
    action: 'org.invitation.revoked',
    ipHash: hashIp(c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { orgId, invitationId: invId },
  });
  return c.json({ revoked: invId });
});

/**
 * Pending team invitations for the signed-in user. Drives the
 * dashboard's "you have a pending team invite" banner — parallel to
 * /v1/me/invitations which already does the project-level equivalent.
 */
orgsRouter.get('/v1/me/org-invitations', async (c) => {
  const user = c.get('user')!;
  const rows = await pendingOrgInvitationsForEmail(user.email);
  return c.json({ invitations: rows });
});

/**
 * Accept an org invitation. Token comes from the email link OR (when
 * the user is already signed in) from a dashboard-initiated accept.
 */
const acceptSchema = z.object({
  token: z.string().min(20).max(1024),
});

orgsRouter.post('/v1/org-invitations/accept', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  try {
    const accepted = await acceptOrgInvitation({
      token: parsed.data.token,
      userId: user.id,
      userEmail: user.email,
    });
    await audit({
      actorId: user.id,
      projectId: null,
      action: 'org.invitation.accepted',
      ipHash: hashIp(c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { orgId: accepted.orgId, role: accepted.role },
    });
    return c.json({ accepted: true, orgId: accepted.orgId, role: accepted.role });
  } catch (err) {
    return c.json(
      {
        code: 'invitation_invalid',
        message: err instanceof Error ? err.message : 'invitation invalid',
      },
      400,
    );
  }
});
