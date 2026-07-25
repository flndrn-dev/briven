/**
 * Project service badges — mint / list / revoke.
 *
 *   GET    /v1/projects/:id/service-badges?product=db|s3|auth
 *   POST   /v1/projects/:id/service-badges
 *   DELETE /v1/projects/:id/service-badges/:badgeId
 *
 * Dashboard session only (admin) — same bar as api-keys / storage-keys mint.
 * Secrets returned once on create.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import { requireAuth } from '../middleware/session.js';
import type { AppEnv } from '../types/app-env.js';
import { audit, hashIp } from '../services/audit.js';
import { assertProjectRole } from '../services/access.js';
import {
  createServiceBadge,
  isMintableServiceBadgeProduct,
  isServiceBadgeProduct,
  isServiceBadgeRole,
  listServiceBadges,
  revokeServiceBadge,
} from '../services/service-badges.js';

const createSchema = z.object({
  name: z.string().min(1).max(80),
  product: z.enum(['db', 's3', 'auth', 'pay']),
  role: z.enum(['viewer', 'developer', 'admin']).optional(),
  expiresInDays: z.number().int().positive().max(365).optional(),
});

export const serviceBadgesRouter = new Hono<AppEnv>();

serviceBadgesRouter.use('/v1/projects/:id/service-badges', requireAuth());
serviceBadgesRouter.use('/v1/projects/:id/service-badges/*', requireAuth());

serviceBadgesRouter.get('/v1/projects/:id/service-badges', async (c) => {
  const user = c.get('user')!;
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'admin');
  const productQ = c.req.query('product');
  const product =
    productQ && isServiceBadgeProduct(productQ) ? productQ : undefined;
  const badges = await listServiceBadges(project.id, product);
  return c.json({
    badges,
    products: {
      db: 'Doltgres database (tables, query, studio)',
      s3: 'S3 / object storage for this project bucket',
      auth: 'Auth machine clients (SuperTokens-style M2M)',
      pay: 'Briven Pay (coming later)',
    },
  });
});

serviceBadgesRouter.post('/v1/projects/:id/service-badges', async (c) => {
  const user = c.get('user')!;
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'admin');
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        code: 'validation_failed',
        message: 'invalid request body',
        issues: parsed.error.issues,
      },
      400,
    );
  }
  if (!isMintableServiceBadgeProduct(parsed.data.product)) {
    return c.json(
      {
        code: 'product_not_available',
        message:
          parsed.data.product === 'pay'
            ? 'Briven Pay badges are not available yet'
            : 'unknown product',
      },
      400,
    );
  }
  if (parsed.data.role && !isServiceBadgeRole(parsed.data.role)) {
    return c.json({ code: 'validation_failed', message: 'invalid role' }, 400);
  }

  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
    : undefined;

  try {
    const created = await createServiceBadge({
      projectId: project.id,
      product: parsed.data.product,
      name: parsed.data.name,
      role: parsed.data.role,
      createdBy: user.id,
      expiresAt,
    });

    await audit({
      actorId: user.id,
      projectId: project.id,
      action: 'service_badge.create',
      ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: {
        badgeId: created.badge.id,
        product: created.badge.product,
        name: created.badge.name,
        role: created.badge.role,
      },
    });

    return c.json(
      {
        badge: created.badge,
        // One-time secrets — never stored as plaintext after this response.
        plaintext: created.plaintext,
        s3: created.s3 ?? null,
        auth: created.auth ?? null,
      },
      201,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not configured') || message.includes('storage')) {
      return c.json(
        { code: 'storage_not_configured', message },
        503,
      );
    }
    throw err;
  }
});

serviceBadgesRouter.delete('/v1/projects/:id/service-badges/:badgeId', async (c) => {
  const user = c.get('user')!;
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'admin');
  const badgeId = c.req.param('badgeId');
  await revokeServiceBadge(project.id, badgeId);
  await audit({
    actorId: user.id,
    projectId: project.id,
    action: 'service_badge.revoke',
    ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { badgeId },
  });
  return c.json({ ok: true, badgeId });
});
