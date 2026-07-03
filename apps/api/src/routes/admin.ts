import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { env } from '../env.js';
import { requireAdmin } from '../middleware/admin.js';
import { requireAuth } from '../middleware/session.js';
import { requireRecentMfa } from '../middleware/step-up.js';
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
import { getHealthSummary } from '../services/platform-health.js';
import { getAdminOverview } from '../services/admin-overview.js';
import { getUserDeepDetailForAdmin } from '../services/admin-user-detail.js';
import {
  createIncident,
  listIncidents,
  resolveIncident,
  updateIncident,
} from '../services/incidents.js';
import {
  sendMigrationStatusUpdate,
  sendTicketReply,
  sendTicketStatusUpdate,
} from '../lib/email.js';
import { translateConvexSchema } from '../services/convex-schema-translator.js';
import { getMarketingFunnel } from '../services/marketing-events.js';
import { getEmailAdminSummary } from '../services/email-admin.js';
import { log } from '../lib/logger.js';
import {
  getMigrationRequest,
  listMigrationRequestsForAdmin,
  promoteMigrationRequestToUser,
  updateMigrationRequest,
} from '../services/migration-requests.js';
import { fetchRealtimeStats } from '../services/realtime-stats.js';
import { listUsageEvents, retrySkippedUsageEvents } from '../services/usage-admin.js';
import {
  getTierStorageCaps,
  listStorageUsage,
  setProjectStorageLimit,
  updateTierStorageCap,
} from '../services/storage-admin.js';
import { listSuppressions, suppress, unsuppress } from '../services/suppressions.js';
import { incidentSeverity, ticketStatuses } from '../db/schema.js';
import {
  addReply as addTicketReply,
  getTicketByIdForAdmin,
  listTicketsForAdmin,
  renderTicketNumber,
  updateTicket,
  type UpdateTicketInput,
} from '../services/support-tickets.js';
import { NotFoundError, ValidationError } from '@briven/shared';

const userActionSchema = z.object({ userId: z.string().min(1) });

function ipHash(c: Context<AppEnv>): string | null {
  const fwd = c.req.raw.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0]!.trim() : null;
  return hashIp(ip);
}

export const adminRouter = new Hono<AppEnv>();

adminRouter.use('/v1/admin/*', requireAuth());
adminRouter.use('/v1/admin/*', requireAdmin());
// Every admin MUTATION requires fresh step-up auth per CLAUDE.md §5.4.
// Reads pass through so the dashboard can render without re-prompting on
// every page navigation; writes (POST/PATCH/DELETE/PUT) check
// users.last_mfa_at and return 403 step_up_required when stale. The
// dashboard surfaces an inline password prompt to refresh in-place.
const mfa = requireRecentMfa(10);
adminRouter.use('/v1/admin/*', async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }
  return mfa(c, next);
});

adminRouter.get('/v1/admin/stats', async (c) => c.json(await adminStats()));

/**
 * Admin landing overview — one fan-out of REAL platform signals. Contract with
 * apps/web/(admin)/admin/overview-client.tsx (the Overview type). Billing
 * subscribers/mrr/churn are null while Mavi Pay is not connected (honest, not
 * fabricated); planMix + counts + deploys + health + open incidents are live.
 */
adminRouter.get('/v1/admin/overview', async (c) => c.json(await getAdminOverview()));

/**
 * Platform health — checks + host metrics, literally getHealthSummary(). The
 * web health page consumes { checks, host }. host is null when Prometheus is
 * unset/unreachable.
 */
adminRouter.get('/v1/admin/health', async (c) => c.json(await getHealthSummary()));

adminRouter.get('/v1/admin/users', async (c) => {
  const rows = await listUsers(200);
  return c.json({ users: rows });
});

adminRouter.get('/v1/admin/users/:id', async (c) => {
  const userId = c.req.param('id');
  try {
    // Deep per-user detail: profile + company + geo-resolved last sign-in +
    // per-project storage usage + totals + audit activity. Contract mirrors
    // apps/web/(admin)/admin/users/[id] (Overview `user`/`projects`/`totals`/
    // `activity` shape). Real numbers or null — never fabricated.
    const detail = await getUserDeepDetailForAdmin(userId);
    return c.json(detail);
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) {
      return c.json({ code: 'not_found' }, 404);
    }
    throw err;
  }
});

adminRouter.get('/v1/admin/projects', async (c) => {
  const rows = await listProjects(500);
  return c.json({ projects: rows });
});

/**
 * Storage admin (Sprint 4) — per-project table + row counts. Bytes are
 * unmeasurable on DoltGres, so usage is reported as tables + rows. Phase 1 is
 * read-only; limits + flagging land in Phase 2.
 */
adminRouter.get('/v1/admin/storage', async (c) => {
  const usage = await listStorageUsage();
  return c.json({ usage });
});

adminRouter.get('/v1/admin/storage/tier-caps', async (c) => {
  const caps = await getTierStorageCaps();
  return c.json({ caps });
});

const tierParam = z.enum(['free', 'pro', 'team']);
const capBody = z.object({
  maxRows: z.number().int().nonnegative(),
  maxTables: z.number().int().nonnegative(),
});

/** Edit a tier's storage caps (takes effect immediately, no redeploy). */
adminRouter.patch('/v1/admin/storage/tier-caps/:tier', async (c) => {
  const parsedTier = tierParam.safeParse(c.req.param('tier'));
  if (!parsedTier.success) throw new ValidationError('unknown tier');
  const body = capBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new ValidationError('expected { maxRows, maxTables } as whole numbers');
  const user = c.get('user');
  await updateTierStorageCap(parsedTier.data, body.data, user?.id ?? null);
  await audit({
    actorId: user?.id ?? null,
    projectId: null,
    action: 'admin.storage.tier_cap.update',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { tier: parsedTier.data, ...body.data },
  });
  return c.json({ ok: true });
});

const projectLimitBody = z.object({
  maxRows: z.number().int().nonnegative().nullable(),
  maxTables: z.number().int().nonnegative().nullable(),
});

/** Set or clear a single project's storage override (null = inherit tier cap). */
adminRouter.patch('/v1/admin/storage/projects/:id', async (c) => {
  const projectId = c.req.param('id');
  const body = projectLimitBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    throw new ValidationError('expected { maxRows, maxTables } (whole numbers or null)');
  }
  const user = c.get('user');
  await setProjectStorageLimit(projectId, body.data, user?.id ?? null);
  await audit({
    actorId: user?.id ?? null,
    projectId,
    action: 'admin.storage.project_limit.set',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { ...body.data },
  });
  return c.json({ ok: true });
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
 * Email overview — deliverability + volume roll-up for the admin email
 * events page. Literally getEmailAdminSummary(); shape mirrors what
 * apps/web/(admin)/admin/email-events consumes.
 */
adminRouter.get('/v1/admin/email-overview', async (c) => c.json(await getEmailAdminSummary()));

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

const retrySkippedSchema = z.object({
  // Window in days. 1-90. Operator-supplied so the same endpoint
  // serves both "I just fixed the meter id, retry the last hour" and
  // "we discovered a month-long config gap during reconciliation".
  sinceDays: z.coerce.number().int().min(1).max(90).default(7),
});

adminRouter.post('/v1/admin/usage-events/retry-skipped', async (c) => {
  const actor = c.get('user')!;
  const body = await c.req.json().catch(() => ({}));
  const parsed = retrySkippedSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const result = await retrySkippedUsageEvents({ sinceDays: parsed.data.sinceDays });
  await audit({
    actorId: actor.id,
    projectId: null,
    action: 'admin.usage_events.retry_skipped',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { sinceDays: parsed.data.sinceDays, retried: result.retried },
  });
  return c.json({ retried: result.retried, sinceDays: parsed.data.sinceDays });
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

/* ─── signup allowlist (invite-only beta gate) ───────────────────── */

adminRouter.get('/v1/admin/signup-allowlist', async (c) => {
  const { listAllowlist } = await import('../services/signup-allowlist.js');
  const entries = await listAllowlist();
  return c.json({ entries });
});

adminRouter.post('/v1/admin/signup-allowlist', async (c) => {
  const actor = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      email: z.string().email(),
      notes: z.string().max(500).optional(),
    })
    .safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const { addToAllowlist } = await import('../services/signup-allowlist.js');
  try {
    const entry = await addToAllowlist({
      email: parsed.data.email,
      invitedBy: actor.id,
      notes: parsed.data.notes ?? null,
    });
    await audit({
      actorId: actor.id,
      projectId: null,
      action: 'admin.allowlist.add',
      ipHash: ipHash(c),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { email: entry.email },
    });
    return c.json({ entry }, 201);
  } catch (err) {
    if (err instanceof Error && /already on the allowlist/i.test(err.message)) {
      return c.json({ code: 'duplicate', message: err.message }, 409);
    }
    throw err;
  }
});

adminRouter.delete('/v1/admin/signup-allowlist/:email', async (c) => {
  const actor = c.get('user')!;
  const email = decodeURIComponent(c.req.param('email'));
  const { removeFromAllowlist } = await import('../services/signup-allowlist.js');
  const removed = await removeFromAllowlist(email);
  if (!removed) {
    return c.json({ code: 'not_found' }, 404);
  }
  await audit({
    actorId: actor.id,
    projectId: null,
    action: 'admin.allowlist.remove',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { email },
  });
  return c.json({ ok: true });
});

/**
 * Platform-level launch status — surfaces flags the admin needs to see
 * at a glance during the invite-only → public-beta transition.
 * `openSignups` reads the effective value (DB override → env fallback).
 */
adminRouter.get('/v1/admin/launch-status', async (c) => {
  const actor = c.get('user')!;
  const { getOpenSignupsFlag, getPlatformSetting } = await import(
    '../services/platform-settings.js'
  );
  const { getDb } = await import('../db/client.js');
  const { users } = await import('../db/schema.js');
  const { eq } = await import('drizzle-orm');
  const db = getDb();
  const [userRow] = await db
    .select({ lastMfaAt: users.lastMfaAt })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);
  const [openSignups, maintenanceMode] = await Promise.all([
    getOpenSignupsFlag(),
    getPlatformSetting<boolean>('maintenanceMode', false),
  ]);
  // Compute the actor's step-up freshness so the dashboard can show a
  // banner + re-attest button. Mirrors the 10-min window the
  // requireRecentMfa middleware enforces.
  const lastMfaAt = userRow?.lastMfaAt ?? null;
  const stepUpExpiresAt = lastMfaAt ? new Date(lastMfaAt.getTime() + 10 * 60_000) : null;
  const stepUpFresh = stepUpExpiresAt ? stepUpExpiresAt.getTime() > Date.now() : false;
  return c.json({
    openSignups,
    openSignupsEnvDefault: env.BRIVEN_OPEN_SIGNUPS,
    maintenanceMode,
    discordInviteUrl: env.BRIVEN_DISCORD_INVITE_URL ?? null,
    domain: env.BRIVEN_DOMAIN,
    polarConfigured: Boolean(env.BRIVEN_POLAR_ACCESS_TOKEN),
    mitteraConfigured: Boolean(env.BRIVEN_MITTERA_API_KEY),
    minioConfigured: Boolean(
      env.BRIVEN_MINIO_ENDPOINT && env.BRIVEN_MINIO_ACCESS_KEY && env.BRIVEN_MINIO_SECRET_KEY,
    ),
    stepUpFresh,
    stepUpExpiresAt: stepUpExpiresAt?.toISOString() ?? null,
  });
});

/**
 * Flip the dashboard-controllable open-signups flag. Writes
 * `platform_settings.openSignups = <bool>` + invalidates the in-process
 * cache so the change takes effect within ~60s on peer instances and
 * immediately on the writer. Audited as admin.signups.toggle.
 */
adminRouter.post('/v1/admin/launch-status/open-signups', async (c) => {
  const actor = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ openSignups: z.boolean() }).safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const { setPlatformSetting } = await import('../services/platform-settings.js');
  await setPlatformSetting('openSignups', parsed.data.openSignups, actor.id);
  await audit({
    actorId: actor.id,
    projectId: null,
    action: 'admin.signups.toggle',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { openSignups: parsed.data.openSignups },
  });
  return c.json({ openSignups: parsed.data.openSignups });
});

/**
 * Flip the platform-wide maintenance gate. When true, every non-admin
 * route returns 503 until flipped back. Whitelist: /health, /ready,
 * /info, /v1/auth/*, /v1/me, /v1/me/*, /v1/admin/* (so the admin can
 * sign in + flip it back). Audited as admin.maintenance.toggle.
 */
adminRouter.post('/v1/admin/launch-status/maintenance-mode', async (c) => {
  const actor = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ maintenanceMode: z.boolean() }).safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const { setPlatformSetting } = await import('../services/platform-settings.js');
  await setPlatformSetting('maintenanceMode', parsed.data.maintenanceMode, actor.id);
  await audit({
    actorId: actor.id,
    projectId: null,
    action: 'admin.maintenance.toggle',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { maintenanceMode: parsed.data.maintenanceMode },
  });
  return c.json({ maintenanceMode: parsed.data.maintenanceMode });
});

/* ─── incidents (admin write surface; public list on /v1/status/incidents) ─── */

const incidentServicesSchema = z.array(z.string().min(1)).min(1);
const incidentSeveritySchema = z.enum(incidentSeverity);

const createIncidentSchema = z.object({
  startedAt: z.string().datetime().optional(),
  severity: incidentSeveritySchema,
  services: incidentServicesSchema,
  summary: z.string().min(1).max(2000),
  postmortem: z.string().max(20_000).optional(),
});

const updateIncidentSchema = z.object({
  summary: z.string().min(1).max(2000).optional(),
  postmortem: z.string().max(20_000).optional(),
  severity: incidentSeveritySchema.optional(),
  services: incidentServicesSchema.optional(),
});

adminRouter.get('/v1/admin/incidents', async (c) => {
  const rows = await listIncidents({ limit: 100 });
  return c.json({ incidents: rows });
});

adminRouter.post('/v1/admin/incidents', async (c) => {
  const actor = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = createIncidentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  try {
    const incident = await createIncident({
      startedAt: parsed.data.startedAt ? new Date(parsed.data.startedAt) : undefined,
      severity: parsed.data.severity,
      services: parsed.data.services,
      summary: parsed.data.summary,
      postmortem: parsed.data.postmortem,
      createdBy: actor.id,
    });
    await audit({
      actorId: actor.id,
      projectId: null,
      action: 'admin.incident.create',
      ipHash: ipHash(c),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { incidentId: incident.id, severity: incident.severity },
    });
    return c.json({ incident }, 201);
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ code: 'validation_failed', message: err.message }, 400);
    }
    throw err;
  }
});

adminRouter.patch('/v1/admin/incidents/:id', async (c) => {
  const actor = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = updateIncidentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  try {
    const incident = await updateIncident(id, parsed.data);
    await audit({
      actorId: actor.id,
      projectId: null,
      action: 'admin.incident.update',
      ipHash: ipHash(c),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { incidentId: id, fields: Object.keys(parsed.data) },
    });
    return c.json({ incident });
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ code: 'validation_failed', message: err.message }, 400);
    }
    throw err;
  }
});

adminRouter.post('/v1/admin/incidents/:id/resolve', async (c) => {
  const actor = c.get('user')!;
  const id = c.req.param('id');
  const incident = await resolveIncident(id);
  await audit({
    actorId: actor.id,
    projectId: null,
    action: 'admin.incident.resolve',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { incidentId: id },
  });
  return c.json({ incident });
});

/* ─── migration requests (customer-initiated platform imports) ───────── */

const updateMigrationRequestSchema = z.object({
  status: z
    .enum(['new', 'contacted', 'scheduled', 'in_progress', 'completed', 'cancelled'])
    .optional(),
  assignedTo: z.string().nullable().optional(),
  operatorNotes: z.string().max(20_000).optional(),
  // Optional message included in the customer status-update email when
  // the status changes. Persisted-anywhere is intentionally false — once
  // the email ships, the message lives in the audit log + the customer's
  // inbox, not in operator_notes. Keep it under 5kB so the email body
  // stays under most provider limits.
  messageToCustomer: z.string().max(5_000).optional(),
});

adminRouter.get('/v1/admin/migration-requests', async (c) => {
  const openOnly = c.req.query('open') === 'true';
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Number(limitParam) || 100 : 100;
  const rows = await listMigrationRequestsForAdmin({ limit, openOnly });
  return c.json({
    requests: rows.map((r) => ({
      ...r,
      estimatedRows: r.estimatedRows == null ? null : r.estimatedRows.toString(),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
});

adminRouter.get('/v1/admin/migration-requests/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const row = await getMigrationRequest(id);
    return c.json({
      request: {
        ...row,
        estimatedRows: row.estimatedRows == null ? null : row.estimatedRows.toString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    });
  } catch {
    return c.json({ code: 'not_found' }, 404);
  }
});

adminRouter.patch('/v1/admin/migration-requests/:id', async (c) => {
  const actor = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = updateMigrationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  try {
    // Snapshot the row pre-update so we can detect a real status change
    // and fire the customer notification only when something actually
    // changed. messageToCustomer is intentionally pulled out and never
    // forwarded to updateMigrationRequest — it's email-only payload.
    const { messageToCustomer, ...patch } = parsed.data;
    const before = await getMigrationRequest(id);
    const request = await updateMigrationRequest(id, patch);
    await audit({
      actorId: actor.id,
      projectId: null,
      action: 'admin.migration_request.update',
      ipHash: ipHash(c),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: {
        requestId: id,
        fields: Object.keys(patch),
        statusChanged: before.status !== request.status,
        messageIncluded: Boolean(messageToCustomer),
      },
    });
    // Status-change customer notification. Skipped on operator-notes-only
    // edits (no status field) and on no-op status writes. Fire-and-forget
    // so a slow mittera doesn't block the operator's PATCH response.
    if (patch.status && before.status !== request.status) {
      void sendMigrationStatusUpdate({
        requestId: request.id,
        source: request.source,
        contactEmail: request.contactEmail,
        oldStatus: before.status,
        newStatus: request.status,
        operatorMessage: messageToCustomer,
      }).catch((err) => {
        log.error('migration_status_email_failed', {
          requestId: request.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    return c.json({
      request: {
        ...request,
        estimatedRows:
          request.estimatedRows == null ? null : request.estimatedRows.toString(),
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ code: 'validation_failed', message: err.message }, 400);
    }
    throw err;
  }
});

/* ─── support tickets (tagged /contact submissions) ──────────────────── */

interface AdminTicket {
  id: string;
  ticketNumber: string | null;
  status: string;
  topic: string;
  topicCode: string | null;
  name: string;
  email: string;
  subject: string | null;
  message: string;
  country: string | null;
  assignedTo: string | null;
  operatorNotes: string | null;
  createdAt: string;
  handledAt: string | null;
}

function serializeAdminTicket(t: {
  id: string;
  ticketNumber: string | null;
  status: string;
  topic: string;
  topicCode: string | null;
  name: string;
  email: string;
  subject: string | null;
  message: string;
  country: string | null;
  assignedTo: string | null;
  operatorNotes: string | null;
  createdAt: Date;
  handledAt: Date | null;
}): AdminTicket {
  return {
    id: t.id,
    ticketNumber: renderTicketNumber(t.ticketNumber),
    status: t.status,
    topic: t.topic,
    topicCode: t.topicCode,
    name: t.name,
    email: t.email,
    subject: t.subject,
    message: t.message,
    country: t.country,
    assignedTo: t.assignedTo,
    operatorNotes: t.operatorNotes,
    createdAt: t.createdAt.toISOString(),
    handledAt: t.handledAt ? t.handledAt.toISOString() : null,
  };
}

function serializeReply(r: {
  id: string;
  author: string;
  body: string;
  createdAt: Date;
}): { id: string; author: string; body: string; createdAt: string } {
  return { id: r.id, author: r.author, body: r.body, createdAt: r.createdAt.toISOString() };
}

const updateTicketSchema = z.object({
  status: z.enum(ticketStatuses).optional(),
  assignedTo: z.string().max(200).nullable().optional(),
  operatorNotes: z.string().max(20_000).nullable().optional(),
});

const ticketReplySchema = z.object({
  body: z.string().trim().min(1).max(8_000),
});

adminRouter.get('/v1/admin/tickets', async (c) => {
  const statusParam = c.req.query('status');
  const status =
    statusParam && (ticketStatuses as readonly string[]).includes(statusParam)
      ? (statusParam as (typeof ticketStatuses)[number])
      : undefined;
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Number(limitParam) || 100 : 100;
  const rows = await listTicketsForAdmin({ status, limit });
  return c.json({ tickets: rows.map(serializeAdminTicket) });
});

adminRouter.get('/v1/admin/tickets/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const { ticket, replies } = await getTicketByIdForAdmin(id);
    return c.json({
      ticket: serializeAdminTicket(ticket),
      replies: replies.map(serializeReply),
    });
  } catch {
    return c.json({ code: 'not_found' }, 404);
  }
});

adminRouter.patch('/v1/admin/tickets/:id', async (c) => {
  const actor = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = updateTicketSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  try {
    const before = await getTicketByIdForAdmin(id);
    const patch: UpdateTicketInput = parsed.data;
    const ticket = await updateTicket(id, patch);
    const statusChanged = Boolean(patch.status) && before.ticket.status !== ticket.status;
    await audit({
      actorId: actor.id,
      projectId: null,
      action: 'contact_ticket.update',
      ipHash: ipHash(c),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: {
        ticketId: id,
        ticketNumber: renderTicketNumber(ticket.ticketNumber),
        fields: Object.keys(patch),
        statusChanged,
        newStatus: statusChanged ? ticket.status : null,
      },
    });
    // Notify the sender on a real status change to 'replied'/'closed'.
    // Fire-and-forget so mittera latency never blocks the operator.
    const rendered = renderTicketNumber(ticket.ticketNumber);
    if (
      statusChanged &&
      rendered &&
      (ticket.status === 'replied' || ticket.status === 'closed')
    ) {
      void sendTicketStatusUpdate(ticket.email, rendered, ticket.status).catch((err) => {
        log.error('ticket_status_email_failed', {
          ticketId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    return c.json({ ticket: serializeAdminTicket(ticket) });
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ code: 'not_found' }, 404);
    if (err instanceof ValidationError) {
      return c.json({ code: 'validation_failed', message: err.message }, 400);
    }
    throw err;
  }
});

adminRouter.post('/v1/admin/tickets/:id/reply', async (c) => {
  const actor = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = ticketReplySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  try {
    const { reply, ticket } = await addTicketReply(id, 'operator', parsed.data.body);
    const rendered = renderTicketNumber(ticket.ticketNumber);
    await audit({
      actorId: actor.id,
      projectId: null,
      action: 'contact_ticket.reply',
      ipHash: ipHash(c),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { ticketId: id, ticketNumber: rendered, replyId: reply.id },
    });
    // Email the sender the reply. Fire-and-forget.
    if (rendered) {
      void sendTicketReply(ticket.email, rendered, reply.body).catch((err) => {
        log.error('ticket_reply_email_failed', {
          ticketId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    return c.json({ reply: serializeReply(reply) }, 201);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ code: 'not_found' }, 404);
    if (err instanceof ValidationError) {
      return c.json({ code: 'validation_failed', message: err.message }, 400);
    }
    throw err;
  }
});

/**
 * Promote an unauth lead to a user account. Used when an operator
 * verifies (via the contact email match) that the briven user signing
 * in / already signed in is the same person who submitted the lead.
 * Idempotent. Returns { linkedUserId: null } when no user with the
 * lead's email exists yet — operator can wait for sign-up and retry.
 */
adminRouter.get('/v1/admin/marketing-funnel', async (c) => {
  const sinceDays = Math.max(1, Math.min(365, Number(c.req.query('days')) || 30));
  return c.json(await getMarketingFunnel({ sinceDays }));
});

/**
 * Offline convex schema → briven schema DSL translator. Stateless;
 * accepts pasted convex/schema.ts source and returns the draft briven
 * schema for the operator to review and ship. No fetch against the
 * customer's convex deployment — schema bytes come from the operator
 * (typically pasted from the customer during the migration call).
 */
adminRouter.post('/v1/admin/translate-convex-schema', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { source?: string } | null;
  if (!body || typeof body.source !== 'string') {
    return c.json({ code: 'validation_failed', message: 'source string required' }, 400);
  }
  try {
    const result = translateConvexSchema(body.source);
    return c.json(result);
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ code: 'validation_failed', message: err.message }, 400);
    }
    throw err;
  }
});

adminRouter.post('/v1/admin/migration-requests/:id/promote-to-user', async (c) => {
  const actor = c.get('user')!;
  const id = c.req.param('id');
  try {
    const lead = await getMigrationRequest(id);
    const { request, linkedUserId } = await promoteMigrationRequestToUser(
      id,
      lead.contactEmail,
    );
    await audit({
      actorId: actor.id,
      projectId: null,
      action: 'admin.migration_request.promote_to_user',
      ipHash: ipHash(c),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { requestId: id, linkedUserId, matchedEmail: lead.contactEmail },
    });
    return c.json({
      linkedUserId,
      request: {
        ...request,
        estimatedRows:
          request.estimatedRows == null ? null : request.estimatedRows.toString(),
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ code: 'validation_failed', message: err.message }, 400);
    }
    throw err;
  }
});
