import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { rateLimit } from '../middleware/rate-limit.js';
import { requireProjectAuth, requireProjectRole } from '../middleware/project-auth.js';
import { requireServiceProduct } from '../middleware/service-product.js';
import { requireRecentMfa } from '../middleware/step-up.js';
import type { ProjectAppEnv as AppEnv } from '../types/app-env.js';
import { audit, hashIp } from '../services/audit.js';
import { issueShellToken } from '../services/db-shell.js';
import { getProjectInfo } from '../services/projects.js';
import { createSnapshot, listSnapshots, restoreSnapshot } from '../services/snapshots.js';
import {
  checkProjectDbHealth,
  dropProjectDatabase,
  evictProjectPool,
  provisionProjectDatabase,
} from '../db/data-plane.js';

function ipHash(c: Context<AppEnv>): string | null {
  const fwd = c.req.raw.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0]!.trim() : null;
  return hashIp(ip);
}

export const dbRouter = new Hono<AppEnv>();

// `db/shell-token` rotates a privileged DSN — admin-tier. Doltgres wall only.
dbRouter.use(
  '/v1/projects/:id/db/*',
  requireProjectAuth(),
  requireServiceProduct('db'),
  requireProjectRole('admin'),
);

// why: 5/min per project is enough for a human-driven `briven db shell`
// loop and restrictive enough that a leaked api key can't silently
// harvest fresh DSNs.
dbRouter.post(
  '/v1/projects/:id/db/shell-token',
  rateLimit({
    scope: 'db-shell-token',
    limit: 5,
    windowMs: 60_000,
    key: (c) => c.req.param('id') ?? null,
  }),
  async (c) => {
    const projectId = c.req.param('id');
    const user = c.get('user');
    const apiKeyId = c.get('apiKeyId');

    const { dsn, role, expiresAt } = await issueShellToken(projectId);

    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'db.shell_token',
      ipHash: ipHash(c),
      userAgent: c.req.header('user-agent') ?? null,
      // why: record expiry only; DSN + password are never audit-logged.
      metadata: { expiresAt: expiresAt.toISOString(), via: apiKeyId ? 'api_key' : 'session' },
    });

    return c.json({ dsn, role, expiresAt: expiresAt.toISOString() });
  },
);

/* ─── customer: per-project database lifecycle ──────────────────────── */
//
// Same capability as the admin database card, scoped to the caller's own
// project. Router-level gate above already requires project role 'admin';
// reprovision additionally requires 'owner'. The three MUTATIONS carry the
// same recent-step-up rule as admin mutations (requireRecentMfa(10)) — the
// dashboard surfaces an inline password prompt on 403 step_up_required.
// That makes them session-only in practice: api keys / CLI JWTs can't
// attest step-up, so agents use the MCP db_* tools instead.
const dbMfa = requireRecentMfa(10);

/**
 * Health probe — reachability, latency, user-table count, HEAD commit.
 * Fail-soft in the service (never throws), so this always answers 200 for
 * an authorised caller. Also returns the caller's effective project role
 * so the dashboard card can hide owner-only controls without a second
 * round-trip.
 */
dbRouter.get('/v1/projects/:id/db/health', async (c) => {
  const projectId = c.req.param('id');
  const user = c.get('user');
  const apiKeyId = c.get('apiKeyId');
  const health = await checkProjectDbHealth(projectId);
  await audit({
    actorId: user?.id ?? null,
    projectId,
    action: 'project.database.health',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { reachable: health.reachable, via: apiKeyId ? 'api_key' : 'session' },
  });
  return c.json({ health, role: c.get('projectRole') });
});

/** List the project's snapshots (recovery points), newest first. */
dbRouter.get('/v1/projects/:id/db/snapshots', async (c) => {
  const projectId = c.req.param('id');
  const user = c.get('user');
  const apiKeyId = c.get('apiKeyId');
  const snapshots = await listSnapshots(projectId);
  await audit({
    actorId: user?.id ?? null,
    projectId,
    action: 'project.database.snapshots',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { count: snapshots.length, via: apiKeyId ? 'api_key' : 'session' },
  });
  return c.json({ snapshots });
});

/**
 * Restart the project's database connections: evict the cached pool so the
 * very next query opens fresh with a fresh auth handshake. Clears the
 * stuck-connection / stale-auth class of incidents without touching any
 * data. Returns the post-restart health so the UI confirms in one trip.
 */
dbRouter.post(
  '/v1/projects/:id/db/restart',
  rateLimit({
    scope: 'db-restart',
    limit: 5,
    windowMs: 60_000,
    key: (c) => c.req.param('id') ?? null,
  }),
  dbMfa,
  async (c) => {
    const projectId = c.req.param('id');
    const user = c.get('user');
    await evictProjectPool(projectId);
    const health = await checkProjectDbHealth(projectId);
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'project.database.restart',
      ipHash: ipHash(c),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { reachable: health.reachable },
    });
    return c.json({ restarted: true, health });
  },
);

const dbRecoverBody = z.object({
  snapshotId: z.string().min(1),
  confirm: z.string(),
});

/**
 * Recover the project's database to a snapshot. Requires the literal
 * confirm word "RECOVER" (same rule as the MCP db_recover tool). Always
 * takes a fresh manual safety snapshot FIRST — so the recover itself is
 * reversible — then hard-resets to the target and evicts the pool so no
 * connection keeps serving pre-recover state. Audited with both ids.
 */
dbRouter.post(
  '/v1/projects/:id/db/recover',
  rateLimit({
    scope: 'db-recover',
    limit: 3,
    windowMs: 300_000,
    key: (c) => c.req.param('id') ?? null,
  }),
  dbMfa,
  async (c) => {
    const projectId = c.req.param('id');
    const user = c.get('user');
    const parsed = dbRecoverBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
    }
    if (parsed.data.confirm !== 'RECOVER') {
      return c.json(
        { code: 'confirm_mismatch', message: 'type RECOVER to confirm this recovery' },
        400,
      );
    }
    const pre = await createSnapshot(projectId, `pre-recover ${parsed.data.snapshotId}`, {
      auto: false,
    });
    const { restored } = await restoreSnapshot(projectId, parsed.data.snapshotId);
    await evictProjectPool(projectId);
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'project.database.recover',
      ipHash: ipHash(c),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { snapshotId: parsed.data.snapshotId, preRecoverySnapshotId: pre.id },
    });
    return c.json({
      recovered: true,
      preRecoverySnapshotId: pre.id,
      tablesAfterRecover: restored,
    });
  },
);

const dbReprovisionBody = z.object({
  confirmName: z.string().min(1),
  force: z.boolean().optional(),
});

/**
 * Nuke-and-rebuild the project's database: drop it (data AND snapshots
 * gone permanently) and provision a fresh empty one. Owner-only — api
 * keys can never be minted at 'owner', so this is session-only by
 * construction. Guarded by a typed confirmation (the project's slug or
 * name, same as admin) and, like the MCP db_reprovision tool, refuses a
 * healthy non-empty database unless `force` is set — a working database
 * should be recovered, not razed.
 */
dbRouter.post(
  '/v1/projects/:id/db/reprovision',
  rateLimit({
    scope: 'db-reprovision',
    limit: 2,
    windowMs: 3_600_000,
    key: (c) => c.req.param('id') ?? null,
  }),
  requireProjectRole('owner'),
  dbMfa,
  async (c) => {
    const projectId = c.req.param('id');
    const user = c.get('user');
    const parsed = dbReprovisionBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
    }
    const project = await getProjectInfo(projectId);
    if (parsed.data.confirmName !== project.slug && parsed.data.confirmName !== project.name) {
      return c.json(
        {
          code: 'confirm_mismatch',
          message: 'confirmation does not match the project slug or name',
        },
        400,
      );
    }
    const prior = await checkProjectDbHealth(projectId);
    if (prior.reachable && (prior.tableCount ?? 0) > 0 && parsed.data.force !== true) {
      return c.json(
        {
          code: 'healthy_database',
          message: `the database is healthy with ${prior.tableCount} table(s) — recover it instead, or pass force to destroy everything`,
        },
        409,
      );
    }
    await evictProjectPool(projectId);
    await dropProjectDatabase(projectId);
    await provisionProjectDatabase(projectId);
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'project.database.reprovision',
      ipHash: ipHash(c),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { slug: project.slug, forced: parsed.data.force === true },
    });
    return c.json({ reprovisioned: true, health: await checkProjectDbHealth(projectId) });
  },
);
