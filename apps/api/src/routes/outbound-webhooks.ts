import { Hono } from 'hono';
import { z } from 'zod';

import { ValidationError } from '@briven/shared';

import { requireAuth } from '../middleware/session.js';
import { assertProjectRole } from '../services/access.js';
import { audit, hashIp } from '../services/audit.js';
import {
  createSubscriber,
  deleteSubscriber,
  KNOWN_EVENT_TYPES,
  listOutboundDeliveries,
  listSubscribers,
  replayDelivery,
  rotateSubscriberSecret,
  updateSubscriber,
} from '../services/outbound-webhooks.js';
import type { AppEnv } from '../types/app-env.js';

export const outboundWebhooksRouter = new Hono<AppEnv>();

outboundWebhooksRouter.use('/v1/projects/:id/outbound-webhooks', requireAuth());
outboundWebhooksRouter.use('/v1/projects/:id/outbound-webhooks/*', requireAuth());

const NAME_SCHEMA = z.string().min(1).max(64);
const URL_SCHEMA = z.string().url().max(2000);
const EVENT_TYPES_SCHEMA = z.string().min(1).max(500);

const createSchema = z.object({
  name: NAME_SCHEMA,
  targetUrl: URL_SCHEMA,
  eventTypes: EVENT_TYPES_SCHEMA.optional(),
  enabled: z.boolean().optional(),
  allowedIps: z.string().max(500).optional(),
});

const updateSchema = z.object({
  name: NAME_SCHEMA.optional(),
  targetUrl: URL_SCHEMA.optional(),
  eventTypes: EVENT_TYPES_SCHEMA.optional(),
  enabled: z.boolean().optional(),
  allowedIps: z.string().max(500).optional(),
});

const DELIVERY_STATUS_VALUES = ['pending', 'ok', 'failed', 'cancelled'] as const;

function validationResponse(issues: unknown) {
  return { code: 'validation_failed' as const, message: 'invalid request body', issues };
}

outboundWebhooksRouter.get('/v1/projects/:id/outbound-webhooks', async (c) => {
  const user = c.get('user')!;
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'viewer');
  const subscribers = await listSubscribers(project.id);
  return c.json({ subscribers, knownEventTypes: KNOWN_EVENT_TYPES });
});

outboundWebhooksRouter.post('/v1/projects/:id/outbound-webhooks', async (c) => {
  const user = c.get('user')!;
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'admin');
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json(validationResponse(parsed.error.issues), 400);
  try {
    const result = await createSubscriber({
      projectId: project.id,
      name: parsed.data.name,
      targetUrl: parsed.data.targetUrl,
      eventTypes: parsed.data.eventTypes,
      enabled: parsed.data.enabled,
      allowedIps: parsed.data.allowedIps,
      createdBy: user.id,
    });
    await audit({
      actorId: user.id,
      projectId: project.id,
      action: 'outbound-webhook.create',
      ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: {
        subscriberId: result.subscriber.id,
        name: result.subscriber.name,
        eventTypes: result.subscriber.eventTypes,
      },
    });
    return c.json(
      { subscriber: result.subscriber, plaintextSecret: result.plaintextSecret },
      201,
    );
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ code: 'validation_failed', message: err.message }, 400);
    }
    throw err;
  }
});

outboundWebhooksRouter.patch(
  '/v1/projects/:id/outbound-webhooks/:subscriberId',
  async (c) => {
    const user = c.get('user')!;
    const { project } = await assertProjectRole(c.req.param('id'), user.id, 'admin');
    const subscriberId = c.req.param('subscriberId');
    const body = await c.req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return c.json(validationResponse(parsed.error.issues), 400);
    try {
      const subscriber = await updateSubscriber(subscriberId, project.id, parsed.data);
      await audit({
        actorId: user.id,
        projectId: project.id,
        action: 'outbound-webhook.update',
        ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
        userAgent: c.req.header('user-agent') ?? null,
        metadata: { subscriberId, fields: Object.keys(parsed.data) },
      });
      return c.json({ subscriber });
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ code: 'validation_failed', message: err.message }, 400);
      }
      throw err;
    }
  },
);

outboundWebhooksRouter.post(
  '/v1/projects/:id/outbound-webhooks/:subscriberId/rotate-secret',
  async (c) => {
    const user = c.get('user')!;
    const { project } = await assertProjectRole(c.req.param('id'), user.id, 'admin');
    const subscriberId = c.req.param('subscriberId');
    const result = await rotateSubscriberSecret(subscriberId, project.id);
    await audit({
      actorId: user.id,
      projectId: project.id,
      action: 'outbound-webhook.rotate-secret',
      ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { subscriberId },
    });
    return c.json({ subscriber: result.subscriber, plaintextSecret: result.plaintextSecret });
  },
);

outboundWebhooksRouter.delete(
  '/v1/projects/:id/outbound-webhooks/:subscriberId',
  async (c) => {
    const user = c.get('user')!;
    const { project } = await assertProjectRole(c.req.param('id'), user.id, 'admin');
    const subscriberId = c.req.param('subscriberId');
    await deleteSubscriber(subscriberId, project.id);
    await audit({
      actorId: user.id,
      projectId: project.id,
      action: 'outbound-webhook.delete',
      ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { subscriberId },
    });
    return c.json({ ok: true });
  },
);

outboundWebhooksRouter.get(
  '/v1/projects/:id/outbound-webhooks/:subscriberId/deliveries',
  async (c) => {
    const user = c.get('user')!;
    const { project } = await assertProjectRole(c.req.param('id'), user.id, 'viewer');
    const subscriberId = c.req.param('subscriberId');
    const statusParam = c.req.query('status');
    const status =
      statusParam && (DELIVERY_STATUS_VALUES as readonly string[]).includes(statusParam)
        ? (statusParam as (typeof DELIVERY_STATUS_VALUES)[number])
        : undefined;
    const deliveries = await listOutboundDeliveries(subscriberId, project.id, {
      limit: 100,
      status,
    });
    return c.json({ deliveries });
  },
);

outboundWebhooksRouter.post(
  '/v1/projects/:id/outbound-webhooks/:subscriberId/deliveries/:deliveryId/replay',
  async (c) => {
    const user = c.get('user')!;
    const { project } = await assertProjectRole(c.req.param('id'), user.id, 'admin');
    const deliveryId = c.req.param('deliveryId');
    await replayDelivery(deliveryId, project.id);
    await audit({
      actorId: user.id,
      projectId: project.id,
      action: 'outbound-webhook.replay',
      ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { deliveryId },
    });
    return c.json({ ok: true });
  },
);
