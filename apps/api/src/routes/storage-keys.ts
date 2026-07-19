import { Hono } from 'hono';
import { z } from 'zod';

import { env } from '../env.js';
import { log } from '../lib/logger.js';
import {
  requireProjectAuth,
  requireProjectRole,
} from '../middleware/project-auth.js';
import { audit, hashIp } from '../services/audit.js';
import { isMinioAdminConfigured } from '../services/minio-admin.js';
import {
  createStorageKey,
  listStorageKeys,
  revokeStorageKey,
} from '../services/storage-keys.js';
import type { AppEnv } from '../types/app-env.js';
import type { User } from '../middleware/session.js';

/**
 * Customer-facing storage keys — mint / list / revoke bucket-scoped S3 keys for
 * a project. Accepts dashboard session OR project CLI key (brk_…), same as
 * env/db routes — so `briven storage setup` works after Convex-style setup.
 * Secret returned ONCE on create.
 */
export const storageKeysRouter = new Hono<AppEnv>();

storageKeysRouter.use('/v1/projects/:id/storage-keys', requireProjectAuth());
storageKeysRouter.use('/v1/projects/:id/storage-keys/*', requireProjectAuth());

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

storageKeysRouter.get(
  '/v1/projects/:id/storage-keys',
  requireProjectRole('viewer'),
  async (c) => {
    const projectId = c.req.param('id');
    const keys = await listStorageKeys(projectId);
    return c.json({
      keys,
      endpoint: env.BRIVEN_MINIO_PUBLIC_ENDPOINT ?? env.BRIVEN_MINIO_ENDPOINT ?? '',
    });
  },
);

storageKeysRouter.post(
  '/v1/projects/:id/storage-keys',
  requireProjectRole('admin'),
  async (c) => {
    if (!isMinioAdminConfigured()) return notConfigured(c);
    const projectId = c.req.param('id');
    const user = c.get('user') as User | null;

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

    let created;
    try {
      created = await createStorageKey({
        projectId,
        name: parsed.data.name,
        createdBy: user?.id ?? null,
        publicEndpoint: env.BRIVEN_MINIO_PUBLIC_ENDPOINT ?? env.BRIVEN_MINIO_ENDPOINT ?? '',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('storage_key_mint_failed', { projectId, error: message });
      return c.json(
        { code: 'mint_failed', message: `could not mint key — ${message}`.slice(0, 600) },
        502,
      );
    }
    await audit({
      actorId: user?.id ?? c.get('apiKeyId') ?? 'api_key',
      projectId,
      action: 'storage_key.create',
      ipHash: ipHashFrom(c),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { keyId: created.record.id, name: created.record.name, bucket: created.bucket },
    });
    return c.json(created, 201);
  },
);

storageKeysRouter.delete(
  '/v1/projects/:id/storage-keys/:keyId',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const user = c.get('user') as User | null;
    const keyId = c.req.param('keyId');
    await revokeStorageKey(projectId, keyId);
    await audit({
      actorId: user?.id ?? c.get('apiKeyId') ?? 'api_key',
      projectId,
      action: 'storage_key.revoke',
      ipHash: ipHashFrom(c),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { keyId },
    });
    return c.json({ ok: true });
  },
);
