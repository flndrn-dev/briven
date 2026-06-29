import { Hono } from 'hono';
import { z } from 'zod';

import { createHmac } from 'node:crypto';

import { ValidationError } from '@briven/shared';

import { env } from '../env.js';
import { requireProjectAuth, requireProjectRole } from '../middleware/project-auth.js';
import { audit, hashIp } from '../services/audit.js';
import {
  createWebhook,
  decryptEndpointSecret,
  deleteWebhook,
  getWebhookRaw,
  listDeliveries,
  listWebhooks,
  rotateWebhookSecret,
  updateWebhook,
} from '../services/webhooks.js';
import type { AppEnv } from '../types/app-env.js';

export const webhooksAdminRouter = new Hono<AppEnv>();

// requireProjectAuth accepts a session/CLI-JWT OR a project-scoped `brk_`
// API key (setting projectRole for either); per-route requireProjectRole
// enforces the minimum. Carve-out also registered in projects.ts so the
// broad `/v1/projects/*` requireAuth doesn't reject the key first.
webhooksAdminRouter.use('/v1/projects/:id/webhooks', requireProjectAuth());
webhooksAdminRouter.use('/v1/projects/:id/webhooks/*', requireProjectAuth());

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

webhooksAdminRouter.get('/v1/projects/:id/webhooks', requireProjectRole('viewer'), async (c) => {
  const projectId = c.req.param('id');
  const endpoints = await listWebhooks(projectId);
  return c.json({ endpoints });
});

webhooksAdminRouter.post('/v1/projects/:id/webhooks', requireProjectRole('admin'), async (c) => {
  const projectId = c.req.param('id');
  const actorId = c.get('user')?.id ?? null;
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json(validationResponse(parsed.error.issues), 400);

  try {
    const result = await createWebhook({
      projectId,
      name: parsed.data.name,
      functionName: parsed.data.functionName,
      enabled: parsed.data.enabled,
      createdBy: actorId,
    });
    await audit({
      actorId,
      projectId,
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

webhooksAdminRouter.patch(
  '/v1/projects/:id/webhooks/:endpointId',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const actorId = c.get('user')?.id ?? null;
    const endpointId = c.req.param('endpointId');

    const body = await c.req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return c.json(validationResponse(parsed.error.issues), 400);

    try {
      const endpoint = await updateWebhook(endpointId, projectId, parsed.data);
      await audit({
        actorId,
        projectId,
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
  },
);

webhooksAdminRouter.post(
  '/v1/projects/:id/webhooks/:endpointId/rotate-secret',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const actorId = c.get('user')?.id ?? null;
    const endpointId = c.req.param('endpointId');
    const result = await rotateWebhookSecret(endpointId, projectId);
    await audit({
      actorId,
      projectId,
      action: 'webhook.rotate-secret',
      ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { endpointId },
    });
    return c.json({ endpoint: result.endpoint, plaintextSecret: result.plaintextSecret });
  },
);

webhooksAdminRouter.delete(
  '/v1/projects/:id/webhooks/:endpointId',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const actorId = c.get('user')?.id ?? null;
    const endpointId = c.req.param('endpointId');
    await deleteWebhook(endpointId, projectId);
    await audit({
      actorId,
      projectId,
      action: 'webhook.delete',
      ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { endpointId },
    });
    return c.json({ ok: true });
  },
);

const DELIVERY_STATUS_VALUES = [
  'ok',
  'rejected_signature',
  'rejected_replay',
  'invoke_error',
  'disabled',
] as const;

/**
 * Test-fire — mints a sample payload, signs it with the endpoint's
 * stored secret, and POSTs to the endpoint's own public URL. The
 * round-trip exercises the same path an external caller takes:
 * signature verification + delivery recording + function invocation.
 *
 * The result is returned inline so the dashboard can show "200 / 401 /
 * 410 / 502" + duration without forcing the admin to refresh the
 * deliveries log. A delivery row is still recorded by the public route
 * during the round-trip — that's the truth-source if the dashboard
 * response is missed.
 */
webhooksAdminRouter.post(
  '/v1/projects/:id/webhooks/:endpointId/test-fire',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const actorId = c.get('user')?.id ?? null;
    const endpointId = c.req.param('endpointId');
    const endpoint = await getWebhookRaw(endpointId, projectId);
    const secret = decryptEndpointSecret(endpoint);

    const timestamp = String(Date.now());
    const body = JSON.stringify({
      test: true,
      sentAt: new Date().toISOString(),
      triggeredBy: actorId,
      endpoint: { id: endpoint.id, name: endpoint.name },
    });
    const signature = `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

    const url = `${env.BRIVEN_API_ORIGIN}/webhooks/${projectId}/${endpoint.id}`;
    const t0 = Date.now();
    let status: number | null = null;
    let responseBody: string | null = null;
    let networkError: string | null = null;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-briven-signature': signature,
          'x-briven-timestamp': timestamp,
        },
        body,
        // The api host signs its own request to itself — should resolve
        // fast, but cap to keep the dashboard responsive when the
        // function itself is slow or hung.
        signal: AbortSignal.timeout(15_000),
      });
      status = res.status;
      const raw = await res.text().catch(() => '');
      // Truncate so a runaway function body can't blow up the dashboard
      // JSON payload — first 4 KiB is plenty to see what went wrong.
      responseBody = raw.length > 4096 ? `${raw.slice(0, 4096)}…` : raw;
    } catch (err) {
      networkError = err instanceof Error ? err.message : 'fetch failed';
    }
    const durationMs = Date.now() - t0;

    await audit({
      actorId,
      projectId,
      action: 'webhook.test-fire',
      ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { endpointId, status, durationMs },
    });

    return c.json({
      ok: status !== null && status >= 200 && status < 300,
      status,
      durationMs,
      url,
      responseBody,
      networkError,
    });
  },
);

webhooksAdminRouter.get(
  '/v1/projects/:id/webhooks/:endpointId/deliveries',
  requireProjectRole('viewer'),
  async (c) => {
    const projectId = c.req.param('id');
    const endpointId = c.req.param('endpointId');
    const statusParam = c.req.query('status');
    const status =
      statusParam && (DELIVERY_STATUS_VALUES as readonly string[]).includes(statusParam)
        ? (statusParam as (typeof DELIVERY_STATUS_VALUES)[number])
        : undefined;
    const deliveries = await listDeliveries(endpointId, projectId, { limit: 100, status });
    return c.json({ deliveries });
  },
);
