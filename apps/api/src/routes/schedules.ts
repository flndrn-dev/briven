import { Hono } from 'hono';
import { z } from 'zod';

import { ValidationError } from '@briven/shared';

import { requireProjectAuth, requireProjectRole } from '../middleware/project-auth.js';
import { audit, hashIp } from '../services/audit.js';
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  nextRunAfter,
  parseCron,
  updateSchedule,
} from '../services/schedules.js';
import type { AppEnv } from '../types/app-env.js';

export const schedulesRouter = new Hono<AppEnv>();

// requireProjectAuth accepts a session/CLI-JWT OR a project-scoped `brk_`
// API key (setting projectRole for either); per-route requireProjectRole
// enforces the minimum. Carve-out also registered in projects.ts so the
// broad `/v1/projects/*` requireAuth doesn't reject the key first.
schedulesRouter.use('/v1/projects/:id/schedules', requireProjectAuth());
schedulesRouter.use('/v1/projects/:id/schedules/*', requireProjectAuth());

// jsonb args column: any JSON-shaped value. We disallow non-object roots
// so the dashboard form has a clear contract (rows of key/value pairs).
const ARGS_SCHEMA = z.record(z.string(), z.unknown()).optional();
const NAME_SCHEMA = z.string().min(1).max(64);
const FN_SCHEMA = z.string().min(1).max(128);
const CRON_SCHEMA = z.string().min(1).max(64);

const createSchema = z.object({
  name: NAME_SCHEMA,
  functionName: FN_SCHEMA,
  cronExpression: CRON_SCHEMA,
  args: ARGS_SCHEMA,
  enabled: z.boolean().optional(),
});

const updateSchema = z.object({
  name: NAME_SCHEMA.optional(),
  functionName: FN_SCHEMA.optional(),
  cronExpression: CRON_SCHEMA.optional(),
  args: ARGS_SCHEMA,
  enabled: z.boolean().optional(),
});

function validationResponse(issues: unknown) {
  return {
    code: 'validation_failed' as const,
    message: 'invalid request body',
    issues,
  };
}

schedulesRouter.get('/v1/projects/:id/schedules', requireProjectRole('viewer'), async (c) => {
  const projectId = c.req.param('id');
  const rows = await listSchedules(projectId);
  return c.json({ schedules: rows });
});

schedulesRouter.post('/v1/projects/:id/schedules', requireProjectRole('developer'), async (c) => {
  const projectId = c.req.param('id');
  const actorId = c.get('user')?.id ?? null;
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json(validationResponse(parsed.error.issues), 400);

  try {
    const schedule = await createSchedule({
      projectId,
      name: parsed.data.name,
      functionName: parsed.data.functionName,
      cronExpression: parsed.data.cronExpression,
      args: parsed.data.args ?? {},
      enabled: parsed.data.enabled,
      createdBy: actorId,
    });
    await audit({
      actorId,
      projectId,
      action: 'schedule.create',
      ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: {
        scheduleId: schedule.id,
        name: schedule.name,
        functionName: schedule.functionName,
        cronExpression: schedule.cronExpression,
      },
    });
    return c.json({ schedule }, 201);
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ code: 'validation_failed', message: err.message }, 400);
    }
    throw err;
  }
});

schedulesRouter.patch(
  '/v1/projects/:id/schedules/:scheduleId',
  requireProjectRole('developer'),
  async (c) => {
    const projectId = c.req.param('id');
    const actorId = c.get('user')?.id ?? null;
    const scheduleId = c.req.param('scheduleId');

    const body = await c.req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return c.json(validationResponse(parsed.error.issues), 400);

    try {
      const schedule = await updateSchedule(scheduleId, projectId, parsed.data);
      await audit({
        actorId,
        projectId,
        action: 'schedule.update',
        ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
        userAgent: c.req.header('user-agent') ?? null,
        metadata: {
          scheduleId,
          // Audit log records the keys that changed, not the full row — keeps
          // the audit-log table out of the data-export firing line.
          fields: Object.keys(parsed.data),
        },
      });
      return c.json({ schedule });
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ code: 'validation_failed', message: err.message }, 400);
      }
      throw err;
    }
  },
);

schedulesRouter.delete(
  '/v1/projects/:id/schedules/:scheduleId',
  requireProjectRole('developer'),
  async (c) => {
    const projectId = c.req.param('id');
    const actorId = c.get('user')?.id ?? null;
    const scheduleId = c.req.param('scheduleId');
    // Confirm the row exists in this project before we record audit.
    await getSchedule(scheduleId, projectId);
    await deleteSchedule(scheduleId, projectId);
    await audit({
      actorId,
      projectId,
      action: 'schedule.delete',
      ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { scheduleId },
    });
    return c.json({ ok: true });
  },
);

// Validates a candidate cron expression without writing anything. The
// dashboard form uses this for live "next run preview" UX.
schedulesRouter.post(
  '/v1/projects/:id/schedules/preview',
  requireProjectRole('viewer'),
  async (c) => {
    const body = (await c.req.json().catch(() => null)) as { cronExpression?: unknown } | null;
    if (!body || typeof body.cronExpression !== 'string') {
      return c.json({ code: 'validation_failed', message: 'cronExpression required' }, 400);
    }
    try {
      const sets = parseCron(body.cronExpression);
      const previews: string[] = [];
      let cursor = new Date();
      for (let i = 0; i < 5; i += 1) {
        const next = nextRunAfter(sets, cursor);
        previews.push(next.toISOString());
        cursor = next;
      }
      return c.json({ ok: true, nextRuns: previews });
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ ok: false, code: 'validation_failed', message: err.message }, 400);
      }
      throw err;
    }
  },
);
