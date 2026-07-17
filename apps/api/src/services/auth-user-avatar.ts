/**
 * User avatar upload — Phase 7.2.
 *
 * Generates presigned S3 URLs so the browser can upload directly to MinIO.
 * After upload the client calls PATCH /v1/auth-tenant/user/avatar to store
 * the public serve URL on the user row.
 *
 * Object key: auth-avatars/<projectId>/<userId>/<uuid>
 */

import { env } from '../env.js';
import { presignS3Url } from '../lib/s3-presign.js';
import { isStorageConfigured } from './storage.js';
import { runInProjectDatabase } from '../db/data-plane.js';

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB
export const ALLOWED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

interface StorageEnv {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

function requireStorageEnv(): StorageEnv {
  const endpoint = env.BRIVEN_MINIO_ENDPOINT;
  const accessKey = env.BRIVEN_MINIO_ACCESS_KEY;
  const secretKey = env.BRIVEN_MINIO_SECRET_KEY;
  if (!endpoint || !accessKey || !secretKey) {
    throw new Error('object storage is not configured on this api (BRIVEN_MINIO_* env vars missing)');
  }
  return {
    endpoint,
    region: env.BRIVEN_MINIO_REGION ?? 'us-east-1',
    bucket: env.BRIVEN_MINIO_BUCKET ?? 'briven',
    accessKey,
    secretKey,
  };
}

export { isStorageConfigured };

function objectKey(projectId: string, userId: string, fileId: string): string {
  return `auth-avatars/${projectId}/${userId}/${fileId}`;
}

export function avatarPublicUrl(projectId: string, userId: string, fileId: string): string {
  return `${env.BRIVEN_API_ORIGIN}/v1/auth-tenant/user/avatar/serve?p=${projectId}&u=${userId}&f=${fileId}`;
}

export interface PresignResult {
  uploadUrl: string;
  publicUrl: string;
}

export function generateAvatarPresign(
  projectId: string,
  userId: string,
  contentType: string,
): PresignResult {
  const bare = contentType.split(';', 1)[0]!.trim().toLowerCase();
  if (!(ALLOWED_AVATAR_TYPES as readonly string[]).includes(bare)) {
    throw new Error(`avatar must be one of ${ALLOWED_AVATAR_TYPES.join(', ')}`);
  }

  const cfg = requireStorageEnv();
  const fileId = crypto.randomUUID();
  const key = objectKey(projectId, userId, fileId);

  const uploadUrl = presignS3Url({
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    key,
    method: 'PUT',
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
    expiresIn: 300, // 5 minutes
    contentType: bare,
  });

  return { uploadUrl, publicUrl: avatarPublicUrl(projectId, userId, fileId) };
}

export async function updateUserAvatar(projectId: string, userId: string, imageUrl: string | null): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `UPDATE "_briven_auth_users" SET image = $1, updated_at = now() WHERE id = $2`,
      [imageUrl, userId] as never,
    );
  });
}

export async function getAvatarImage(
  projectId: string,
  userId: string,
  fileId: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const cfg = requireStorageEnv();
  const url = presignS3Url({
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    key: objectKey(projectId, userId, fileId),
    method: 'GET',
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
    expiresIn: 60,
  });
  const res = await fetch(url, { method: 'GET' });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`minio avatar get failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, contentType };
}
