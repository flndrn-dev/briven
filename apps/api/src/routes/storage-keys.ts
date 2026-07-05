import { Hono } from 'hono';
import { z } from 'zod';

import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { requireAuth } from '../middleware/session.js';
import { assertProjectRole } from '../services/access.js';
import { audit, hashIp } from '../services/audit.js';
import { isMinioAdminConfigured } from '../services/minio-admin.js';
import {
  createStorageKey,
  listStorageKeys,
  revokeStorageKey,
} from '../services/storage-keys.js';
import type { AppEnv } from '../types/app-env.js';

/**
 * Customer-facing storage keys — mint / list / revoke bucket-scoped S3 keys for
 * a project. Session + project-role gated like the files routes. The secret is
 * returned ONCE on create and never again.
 */
export const storageKeysRouter = new Hono<AppEnv>();

storageKeysRouter.use('/v1/projects/:id/storage-keys', requireAuth());
storageKeysRouter.use('/v1/projects/:id/storage-keys/*', requireAuth());

const createSchema = z.object({ name: z.string().min(1).max(80) });

function ipHashFrom(c: {
  req: { header: (n: string) => string | undefined };
}): string | null {
  return hashIp(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null);
}

function notConfigured(c: { json: (b: unknown, s: number) => Response }) {
  return c.json(
    { code: 'storage_not_configured', message: 'object storage is not configured on this api' },
    503,
  );
}

storageKeysRouter.get('/v1/projects/:id/storage-keys', async (c) => {
  const user = c.get('user')!;
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'viewer');
  const keys = await listStorageKeys(project.id);
  return c.json({ keys });
});

storageKeysRouter.post('/v1/projects/:id/storage-keys', async (c) => {
  if (!isMinioAdminConfigured()) return notConfigured(c);
  const user = c.get('user')!;
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'admin');

  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
      400,
    );
  }

  let created;
  try {
    created = await createStorageKey({
      projectId: project.id,
      name: parsed.data.name,
      createdBy: user.id,
      publicEndpoint: env.BRIVEN_MINIO_PUBLIC_ENDPOINT ?? env.BRIVEN_MINIO_ENDPOINT ?? '',
    });
  } catch (err) {
    // Surface the REAL reason (mc/MinIO error) instead of a generic 500, so the
    // operator sees "connection refused" / "Access Denied" / etc. directly.
    const message = err instanceof Error ? err.message : String(err);
    log.error('storage_key_mint_failed', { projectId: project.id, error: message });
    return c.json({ code: 'mint_failed', message: `could not mint key — ${message}`.slice(0, 600) }, 502);
  }
  await audit({
    actorId: user.id,
    projectId: project.id,
    action: 'storage_key.create',
    ipHash: ipHashFrom(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { keyId: created.record.id, name: created.record.name, bucket: created.bucket },
  });
  return c.json(created, 201);
});

storageKeysRouter.delete('/v1/projects/:id/storage-keys/:keyId', async (c) => {
  const user = c.get('user')!;
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'admin');
  const keyId = c.req.param('keyId');
  await revokeStorageKey(project.id, keyId);
  await audit({
    actorId: user.id,
    projectId: project.id,
    action: 'storage_key.revoke',
    ipHash: ipHashFrom(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { keyId },
  });
  return c.json({ ok: true });
});
