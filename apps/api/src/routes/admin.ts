import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { requireAdmin } from '../middleware/admin.js';
import { requireAuth } from '../middleware/session.js';
import type { AppEnv } from '../types/app-env.js';
import {
  ABUSE_RESOLUTION,
  listAbuseReports,
  resolveAbuseReport,
  triageAbuseReport,
  type AbuseStatus,
} from '../services/abuse.js';
import {
  adminStats,
  forceSignOut,
  grantAdmin,
  listProjects,
  listUsers,
  revokeAdmin,
  suspendUser,
  unsuspendUser,
} from '../services/admin.js';
import { audit, hashIp, listAuditByActionPrefix } from '../services/audit.js';
import { listSuppressions, suppress, unsuppress } from '../services/suppressions.js';

const userActionSchema = z.object({ userId: z.string().min(1) });

function ipHash(c: Context<AppEnv>): string | null {
  const fwd = c.req.raw.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0]!.trim() : null;
  return hashIp(ip);
}

export const adminRouter = new Hono<AppEnv>();

adminRouter.use('/v1/admin/*', requireAuth());
adminRouter.use('/v1/admin/*', requireAdmin());

adminRouter.get('/v1/admin/stats', async (c) => c.json(await adminStats()));

adminRouter.get('/v1/admin/users', async (c) => {
  const rows = await listUsers(200);
  return c.json({ users: rows });
});

adminRouter.get('/v1/admin/projects', async (c) => {
  const rows = await listProjects(500);
  return c.json({ projects: rows });
});

/**
 * Mittera email events — pulled from audit_logs filtered to the
 * `mittera.email.*` action prefix. Returns the most recent 200 with a
 * compact shape the dashboard renders without further normalisation.
 */
adminRouter.get('/v1/admin/email-events', async (c) => {
  const rows = await listAuditByActionPrefix('mittera.email.', 200);
  const events = rows.map((r) => ({
    id: r.id,
    eventType: r.action.replace(/^mittera\.email\./, ''),
    messageId:
      r.metadata && typeof r.metadata.messageId === 'string' ? r.metadata.messageId : null,
    bounceCode:
      r.metadata && typeof r.metadata.bounceCode === 'string' ? r.metadata.bounceCode : null,
    bounceMessage:
      r.metadata && typeof r.metadata.bounceMessage === 'string'
        ? r.metadata.bounceMessage
        : null,
    complaintReason:
      r.metadata && typeof r.metadata.complaintReason === 'string'
        ? r.metadata.complaintReason
        : null,
    deliveredAt:
      r.metadata && typeof r.metadata.deliveredAt === 'string' ? r.metadata.deliveredAt : null,
    createdAt: r.createdAt,
  }));
  return c.json({ events });
});

/**
 * Suppression list — emails we won't send to. Populated by the mittera
 * webhook on permanent bounces, complaints, and mittera-side
 * suppressions. Operator can also suppress / unsuppress manually.
 */
adminRouter.get('/v1/admin/email-suppressions', async (c) => {
  const rows = await listSuppressions(500);
  return c.json({ suppressions: rows });
});

const suppressActionSchema = z.object({
  email: z.string().email(),
  reason: z.enum(['permanent_bounce', 'complaint', 'mittera_suppressed', 'manual']).optional(),
  detail: z.string().max(240).optional(),
});

adminRouter.post('/v1/admin/email-suppressions', async (c) => {
  const actor = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = suppressActionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const row = await suppress({
    email: parsed.data.email,
    reason: parsed.data.reason ?? 'manual',
    detail: parsed.data.detail ?? null,
  });
  await audit({
    actorId: actor.id,
    projectId: null,
    action: 'admin.email.suppress',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { email: parsed.data.email, reason: parsed.data.reason ?? 'manual' },
  });
  return c.json({ suppressed: parsed.data.email, created: Boolean(row) });
});

adminRouter.delete('/v1/admin/email-suppressions/:email', async (c) => {
  const actor = c.get('user')!;
  const email = decodeURIComponent(c.req.param('email'));
  const removed = await unsuppress(email);
  await audit({
    actorId: actor.id,
    projectId: null,
    action: 'admin.email.unsuppress',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { email },
  });
  return c.json({ unsuppressed: email, removed });
});

async function parseUserAction(c: Context<AppEnv>) {
  const body = await c.req.json().catch(() => null);
  const parsed = userActionSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues };
  }
  return { ok: true as const, userId: parsed.data.userId };
}

adminRouter.post('/v1/admin/users/suspend', async (c) => {
  const actor = c.get('user')!;
  const parsed = await parseUserAction(c);
  if (!parsed.ok) return c.json({ code: 'validation_failed', issues: parsed.error }, 400);
  await suspendUser(parsed.userId);
  await audit({
    actorId: actor.id,
    projectId: null,
    action: 'admin.user.suspend',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { userId: parsed.userId },
  });
  return c.json({ suspended: parsed.userId });
});

adminRouter.post('/v1/admin/users/unsuspend', async (c) => {
  const actor = c.get('user')!;
  const parsed = await parseUserAction(c);
  if (!parsed.ok) return c.json({ code: 'validation_failed', issues: parsed.error }, 400);
  await unsuspendUser(parsed.userId);
  await audit({
    actorId: actor.id,
    projectId: null,
    action: 'admin.user.unsuspend',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { userId: parsed.userId },
  });
  return c.json({ unsuspended: parsed.userId });
});

adminRouter.post('/v1/admin/users/force-sign-out', async (c) => {
  const actor = c.get('user')!;
  const parsed = await parseUserAction(c);
  if (!parsed.ok) return c.json({ code: 'validation_failed', issues: parsed.error }, 400);
  const n = await forceSignOut(parsed.userId);
  await audit({
    actorId: actor.id,
    projectId: null,
    action: 'admin.user.force_sign_out',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { userId: parsed.userId, sessions: n },
  });
  return c.json({ userId: parsed.userId, sessions: n });
});

adminRouter.post('/v1/admin/users/grant-admin', async (c) => {
  const actor = c.get('user')!;
  const parsed = await parseUserAction(c);
  if (!parsed.ok) return c.json({ code: 'validation_failed', issues: parsed.error }, 400);
  await grantAdmin(parsed.userId);
  await audit({
    actorId: actor.id,
    projectId: null,
    action: 'admin.user.grant_admin',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { userId: parsed.userId },
  });
  return c.json({ userId: parsed.userId, isAdmin: true });
});

adminRouter.post('/v1/admin/users/revoke-admin', async (c) => {
  const actor = c.get('user')!;
  const parsed = await parseUserAction(c);
  if (!parsed.ok) return c.json({ code: 'validation_failed', issues: parsed.error }, 400);
  await revokeAdmin(parsed.userId);
  await audit({
    actorId: actor.id,
    projectId: null,
    action: 'admin.user.revoke_admin',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { userId: parsed.userId },
  });
  return c.json({ userId: parsed.userId, isAdmin: false });
});

/* ─── abuse-report triage ───────────────────────────────────────────── */

const abuseStatusQuery = z.enum(['open', 'triaged', 'resolved']);
const abuseTransitionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('triage'),
    notes: z.string().max(2000).optional(),
  }),
  z.object({
    action: z.literal('resolve'),
    resolution: z.enum(ABUSE_RESOLUTION),
    notes: z.string().max(2000).optional(),
  }),
]);

adminRouter.get('/v1/admin/abuse-reports', async (c) => {
  const statusParam = c.req.query('status');
  let status: AbuseStatus | undefined;
  if (statusParam) {
    const parsed = abuseStatusQuery.safeParse(statusParam);
    if (!parsed.success) {
      return c.json({ code: 'validation_failed', message: 'invalid status' }, 400);
    }
    status = parsed.data;
  }
  const limit = Number(c.req.query('limit') ?? '100');
  const reports = await listAbuseReports({ status, limit: Number.isFinite(limit) ? limit : 100 });
  return c.json({ reports });
});

adminRouter.patch('/v1/admin/abuse-reports/:reportId', async (c) => {
  const actor = c.get('user')!;
  const reportId = c.req.param('reportId');
  if (!reportId) {
    return c.json({ code: 'validation_failed', message: 'reportId required' }, 400);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = abuseTransitionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
      400,
    );
  }
  if (parsed.data.action === 'triage') {
    await triageAbuseReport({
      reportId,
      triagerId: actor.id,
      notes: parsed.data.notes,
      ipHash: ipHash(c),
      userAgent: c.req.header('user-agent') ?? null,
    });
    return c.json({ reportId, status: 'triaged' });
  }
  await resolveAbuseReport({
    reportId,
    resolverId: actor.id,
    resolution: parsed.data.resolution,
    notes: parsed.data.notes,
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
  });
  return c.json({ reportId, status: 'resolved', resolution: parsed.data.resolution });
});
