import { Hono } from 'hono';
import { z } from 'zod';

import { ValidationError } from '@briven/shared';

import { requireProjectAuth, requireProjectRole } from '../middleware/project-auth.js';
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

// requireProjectAuth accepts BOTH a session/CLI-JWT and a project-scoped
// `brk_` API key (it sets `projectRole` for either), so storage management
// works from the SDK/CLI as well as the dashboard. Per-route
// requireProjectRole enforces the minimum role on the resolved projectRole;
// the `briven deploy`-style carve-out is also registered in projects.ts so
// the broad `/v1/projects/*` requireAuth doesn't reject the key first.
storageRouter.use('/v1/projects/:id/files', requireProjectAuth());
storageRouter.use('/v1/projects/:id/files/*', requireProjectAuth());

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

storageRouter.get('/v1/projects/:id/files', requireProjectRole('viewer'), async (c) => {
  if (!isStorageConfigured()) return notConfigured(c);
  const projectId = c.req.param('id');
  const files = await listFiles(projectId);
  return c.json({ files });
});

storageRouter.post(
  '/v1/projects/:id/files/upload-url',
  requireProjectRole('developer'),
  async (c) => {
    if (!isStorageConfigured()) return notConfigured(c);
    const projectId = c.req.param('id');
    const actorId = c.get('user')?.id ?? null;

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
        projectId,
        name: parsed.data.name,
        contentType: parsed.data.contentType,
        sizeBytes: parsed.data.sizeBytes,
        uploadedBy: actorId,
      });
      await audit({
        actorId,
        projectId,
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
  },
);

storageRouter.get(
  '/v1/projects/:id/files/:fileId/download-url',
  requireProjectRole('viewer'),
  async (c) => {
    if (!isStorageConfigured()) return notConfigured(c);
    const projectId = c.req.param('id');
    const fileId = c.req.param('fileId');
    const result = await presignDownload(fileId, projectId);
    return c.json({
      file: result.file,
      downloadUrl: result.downloadUrl,
      expiresInSec: result.expiresInSec,
    });
  },
);

storageRouter.delete(
  '/v1/projects/:id/files/:fileId',
  requireProjectRole('developer'),
  async (c) => {
    if (!isStorageConfigured()) return notConfigured(c);
    const projectId = c.req.param('id');
    const actorId = c.get('user')?.id ?? null;
    const fileId = c.req.param('fileId');
    const file = await deleteFile(fileId, projectId);
    await audit({
      actorId,
      projectId,
      action: 'file.delete',
      ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { fileId, name: file.name },
    });
    return c.json({ ok: true });
  },
);
