import { Hono } from 'hono';
import { z } from 'zod';

import { ValidationError } from '@briven/shared';

import { requireAuth } from '../middleware/session.js';
import { assertProjectRole } from '../services/access.js';
import { audit, hashIp } from '../services/audit.js';
import {
  createWebhook,
  deleteWebhook,
  listDeliveries,
  listWebhooks,
  rotateWebhookSecret,
  updateWebhook,
} from '../services/webhooks.js';
import type { AppEnv } from '../types/app-env.js';

export const webhooksAdminRouter = new Hono<AppEnv>();

webhooksAdminRouter.use('/v1/projects/:id/webhooks', requireAuth());
webhooksAdminRouter.use('/v1/projects/:id/webhooks/*', requireAuth());

const NAME_SCHEMA = z.string().min(1).max(64);
const FN_SCHEMA = z.string().min(1).max(128);

const createSchema = z.object({
  name: NAME_SCHEMA,
  functionName: FN_SCHEMA,
  enabled: z.boolean().optional(),
});

const updateSchema = z.object({
  name: NAME_SCHEMA.optional(),
  functionName: FN_SCHEMA.optional(),
  enabled: z.boolean().optional(),
});

function validationResponse(issues: unknown) {
  return { code: 'validation_failed' as const, message: 'invalid request body', issues };
}

webhooksAdminRouter.get('/v1/projects/:id/webhooks', async (c) => {
  const user = c.get('user')!;
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'viewer');
  const endpoints = await listWebhooks(project.id);
  return c.json({ endpoints });
});

webhooksAdminRouter.post('/v1/projects/:id/webhooks', async (c) => {
  const user = c.get('user')!;
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'admin');
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json(validationResponse(parsed.error.issues), 400);

  try {
    const result = await createWebhook({
      projectId: project.id,
      name: parsed.data.name,
      functionName: parsed.data.functionName,
      enabled: parsed.data.enabled,
      createdBy: user.id,
    });
    await audit({
      actorId: user.id,
      projectId: project.id,
      action: 'webhook.create',
      ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: {
        endpointId: result.endpoint.id,
        name: result.endpoint.name,
        functionName: result.endpoint.functionName,
      },
    });
    return c.json(
      {
        endpoint: result.endpoint,
        // Per CLAUDE.md §5.4 — plaintext returned once. The caller must
        // store it immediately; we never log it and the API never
        // surfaces it again.
        plaintextSecret: result.plaintextSecret,
      },
      201,
    );
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ code: 'validation_failed', message: err.message }, 400);
    }
    throw err;
  }
});

webhooksAdminRouter.patch('/v1/projects/:id/webhooks/:endpointId', async (c) => {
  const user = c.get('user')!;
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'admin');
  const endpointId = c.req.param('endpointId');

  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return c.json(validationResponse(parsed.error.issues), 400);

  try {
    const endpoint = await updateWebhook(endpointId, project.id, parsed.data);
    await audit({
      actorId: user.id,
      projectId: project.id,
      action: 'webhook.update',
      ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { endpointId, fields: Object.keys(parsed.data) },
    });
    return c.json({ endpoint });
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ code: 'validation_failed', message: err.message }, 400);
    }
    throw err;
  }
});

webhooksAdminRouter.post(
  '/v1/projects/:id/webhooks/:endpointId/rotate-secret',
  async (c) => {
    const user = c.get('user')!;
    const { project } = await assertProjectRole(c.req.param('id'), user.id, 'admin');
    const endpointId = c.req.param('endpointId');
    const result = await rotateWebhookSecret(endpointId, project.id);
    await audit({
      actorId: user.id,
      projectId: project.id,
      action: 'webhook.rotate-secret',
      ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { endpointId },
    });
    return c.json({ endpoint: result.endpoint, plaintextSecret: result.plaintextSecret });
  },
);

webhooksAdminRouter.delete('/v1/projects/:id/webhooks/:endpointId', async (c) => {
  const user = c.get('user')!;
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'admin');
  const endpointId = c.req.param('endpointId');
  await deleteWebhook(endpointId, project.id);
  await audit({
    actorId: user.id,
    projectId: project.id,
    action: 'webhook.delete',
    ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { endpointId },
  });
  return c.json({ ok: true });
});

const DELIVERY_STATUS_VALUES = [
  'ok',
  'rejected_signature',
  'rejected_replay',
  'invoke_error',
  'disabled',
] as const;

webhooksAdminRouter.get(
  '/v1/projects/:id/webhooks/:endpointId/deliveries',
  async (c) => {
    const user = c.get('user')!;
    const { project } = await assertProjectRole(c.req.param('id'), user.id, 'viewer');
    const endpointId = c.req.param('endpointId');
    const statusParam = c.req.query('status');
    const status =
      statusParam && (DELIVERY_STATUS_VALUES as readonly string[]).includes(statusParam)
        ? (statusParam as (typeof DELIVERY_STATUS_VALUES)[number])
        : undefined;
    const deliveries = await listDeliveries(endpointId, project.id, { limit: 100, status });
    return c.json({ deliveries });
  },
);
