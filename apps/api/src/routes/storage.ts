import { Hono } from 'hono';
import { z } from 'zod';

import { ValidationError } from '@briven/shared';

import { requireAuth } from '../middleware/session.js';
import { assertProjectRole } from '../services/access.js';
import { audit, hashIp } from '../services/audit.js';
import {
  deleteFile,
  isStorageConfigured,
  listFiles,
  presignDownload,
  presignUpload,
} from '../services/storage.js';
import type { AppEnv } from '../types/app-env.js';

export const storageRouter = new Hono<AppEnv>();

storageRouter.use('/v1/projects/:id/files', requireAuth());
storageRouter.use('/v1/projects/:id/files/*', requireAuth());

const uploadSchema = z.object({
  name: z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().min(0),
});

function notConfigured(c: { json: (b: unknown, s: number) => Response }) {
  return c.json(
    {
      code: 'storage_not_configured',
      message: 'object storage is not configured on this api',
    },
    503,
  );
}

storageRouter.get('/v1/projects/:id/files', async (c) => {
  if (!isStorageConfigured()) return notConfigured(c);
  const user = c.get('user')!;
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'viewer');
  const files = await listFiles(project.id);
  return c.json({ files });
});

storageRouter.post('/v1/projects/:id/files/upload-url', async (c) => {
  if (!isStorageConfigured()) return notConfigured(c);
  const user = c.get('user')!;
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'developer');

  const body = await c.req.json().catch(() => null);
  const parsed = uploadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
      400,
    );
  }

  try {
    const result = await presignUpload({
      projectId: project.id,
      name: parsed.data.name,
      contentType: parsed.data.contentType,
      sizeBytes: parsed.data.sizeBytes,
      uploadedBy: user.id,
    });
    await audit({
      actorId: user.id,
      projectId: project.id,
      action: 'file.upload-url',
      ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { fileId: result.file.id, name: parsed.data.name, sizeBytes: parsed.data.sizeBytes },
    });
    return c.json(
      {
        file: result.file,
        uploadUrl: result.uploadUrl,
        requiredHeaders: result.requiredHeaders,
        expiresInSec: result.expiresInSec,
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

storageRouter.get('/v1/projects/:id/files/:fileId/download-url', async (c) => {
  if (!isStorageConfigured()) return notConfigured(c);
  const user = c.get('user')!;
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'viewer');
  const fileId = c.req.param('fileId');
  const result = await presignDownload(fileId, project.id);
  return c.json({
    file: result.file,
    downloadUrl: result.downloadUrl,
    expiresInSec: result.expiresInSec,
  });
});

storageRouter.delete('/v1/projects/:id/files/:fileId', async (c) => {
  if (!isStorageConfigured()) return notConfigured(c);
  const user = c.get('user')!;
  const { project } = await assertProjectRole(c.req.param('id'), user.id, 'developer');
  const fileId = c.req.param('fileId');
  const file = await deleteFile(fileId, project.id);
  await audit({
    actorId: user.id,
    projectId: project.id,
    action: 'file.delete',
    ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { fileId, name: file.name },
  });
  return c.json({ ok: true });
});
