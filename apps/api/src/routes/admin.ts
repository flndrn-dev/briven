import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { requireAdmin } from '../middleware/admin.js';
import { requireAuth } from '../middleware/session.js';
import type { AppEnv } from '../types/app-env.js';
import {
  ABUSE_RESOLUTION,
  listAbuseReports,
  resolveAbuseReport,
  suspendProject,
  triageAbuseReport,
  unsuspendProject,
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
import { listDeploys } from '../services/deploy-history.js';
import { fetchRealtimeStats } from '../services/realtime-stats.js';
import { listUsageEvents } from '../services/usage-admin.js';
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
  // Match both shapes during the audit-log changeover: the old
  // double-prefixed `mittera.email.*` rows (from before 2026-05-10
  // 22:00 UTC) and the new single-prefixed `mittera.*` rows.
  const rows = await listAuditByActionPrefix('mittera.', 200);
  const events = rows.map((r) => ({
    id: r.id,
    // Strip whichever prefix actually fired.
    eventType: r.action.replace(/^mittera\.(email\.)?/, ''),
    messageId:
      r.metadata && typeof r.metadata.messageId === 'string' ? r.metadata.messageId : null,
    // Only present on .sent rows; redacted at write time in lib/email.ts.
    recipientRedacted:
      r.metadata && typeof r.metadata.recipientRedacted === 'string'
        ? r.metadata.recipientRedacted
        : null,
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

/**
 * Deploy history — last N api/realtime/runtime boots. Paired with the
 * `/info.buildSha` endpoint: /info answers "what's running RIGHT NOW",
 * this answers "what happened when". Dashboard renders a compact
 * timeline so an operator can connect "the bug appeared at 14:32" with
 * "deploy abc1234 went live at 14:30".
 */
adminRouter.get('/v1/admin/deploys', async (c) => {
  const service = c.req.query('service') ?? undefined;
  const limitRaw = c.req.query('limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 50;
  const rows = await listDeploys({ service, limit: Number.isFinite(limit) ? limit : 50 });
  return c.json({
    deploys: rows.map((r) => ({
      id: r.id,
      service: r.service,
      buildSha: r.buildSha,
      buildAt: r.buildAt,
      env: r.env,
      bootedAt: r.bootedAt,
    })),
  });
});

/**
 * Usage events — the rows the hourly aggregator writes. Drives the admin
 * "Usage" page so an operator can verify the cron is running and inspect
 * what the Polar push worker is about to send.
 */
adminRouter.get('/v1/admin/usage-events', async (c) => {
  const limitRaw = c.req.query('limit');
  const limit = Math.min(
    Math.max(limitRaw ? Number.parseInt(limitRaw, 10) : 200, 1),
    1000,
  );
  const status = c.req.query('status');
  const rows = await listUsageEvents({ limit, status });
  return c.json({ events: rows });
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
    // When resolution is 'suspended' or 'banned' AND a projectId is
    // provided, the resolve path auto-flips projects.suspended_at. For
    // 'no_action' / 'warned' this field is ignored.
    projectId: z.string().min(1).optional(),
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
    projectId: parsed.data.projectId,
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
  });
  return c.json({
    reportId,
    status: 'resolved',
    resolution: parsed.data.resolution,
    projectSuspended:
      (parsed.data.resolution === 'suspended' || parsed.data.resolution === 'banned') &&
      Boolean(parsed.data.projectId),
  });
});

/* ─── admin: manual project suspend / unsuspend ─────────────────────── */
const projectSuspensionSchema = z.object({
  projectId: z.string().min(1),
  reason: z.string().min(1).max(500).optional(),
});

adminRouter.post('/v1/admin/projects/suspend', async (c) => {
  const actor = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = projectSuspensionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const ok = await suspendProject({
    projectId: parsed.data.projectId,
    actorId: actor.id,
    reason: parsed.data.reason ?? 'admin_action',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
  });
  return c.json({ projectId: parsed.data.projectId, suspended: ok });
});

adminRouter.post('/v1/admin/projects/unsuspend', async (c) => {
  const actor = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ projectId: z.string().min(1) }).safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const ok = await unsuspendProject({
    projectId: parsed.data.projectId,
    actorId: actor.id,
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
  });
  return c.json({ projectId: parsed.data.projectId, unsuspended: ok });
});

/**
 * Live realtime snapshot — proxies the secret-gated /v1/realtime/stats
 * endpoint on the realtime service. Returns 503 when realtime isn't
 * configured (BRIVEN_REALTIME_URL / BRIVEN_RUNTIME_SHARED_SECRET unset)
 * so the admin UI can render a clear "not available" state instead of
 * an empty table.
 */
adminRouter.get('/v1/admin/realtime', async (c) => {
  const stats = await fetchRealtimeStats();
  if (!stats) return c.json({ code: 'realtime_unavailable' }, 503);
  return c.json(stats);
});
