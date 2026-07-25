import { S3Client } from 'bun';
import { ValidationError } from '@briven/shared';

import { env } from '../env.js';
import { isStorageConfigured } from './storage.js';

/**
 * Storage + serving for auth → branding logos (briven-engine).
 *
 * Upload path (dashboard): POST /v1/auth-core/projects/:projectId/branding/logo
 * Public serve: GET /v1/projects/:id/auth/branding/logo (brandingPublicRouter)
 *
 * Object key: auth-branding/<projectId>/logo
 * Uses Bun's S3Client for server-side PUT/GET/DELETE (no presign round-trip).
 */

export const LOGO_MAX_BYTES = 1024 * 1024; // 1 MiB

export const ALLOWED_LOGO_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
] as const;

export type AllowedLogoType = (typeof ALLOWED_LOGO_TYPES)[number];

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
    throw new ValidationError(
      'object storage is not configured on this api (BRIVEN_MINIO_* env vars missing)',
    );
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

function objectKey(projectId: string): string {
  return `auth-branding/${projectId}/logo`;
}

function s3Client(cfg: StorageEnv): S3Client {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    accessKeyId: cfg.accessKey,
    secretAccessKey: cfg.secretKey,
  });
}

/**
 * Pure validator — unit-tested without any network/postgres. Throws a
 * `ValidationError` (400 at the route) on a disallowed content-type or an
 * over-cap / non-positive size.
 */
export function validateLogoUpload(input: { contentType: string; size: number }): void {
  const bare = input.contentType.split(';', 1)[0]!.trim().toLowerCase();
  if (!(ALLOWED_LOGO_TYPES as readonly string[]).includes(bare)) {
    throw new ValidationError(
      `logo must be one of ${ALLOWED_LOGO_TYPES.join(', ')} (got: ${bare || 'none'})`,
    );
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    throw new ValidationError('logo file is empty');
  }
  if (input.size > LOGO_MAX_BYTES) {
    throw new ValidationError(`logo exceeds the ${LOGO_MAX_BYTES} byte (1 MiB) cap`);
  }
}

/**
 * STABLE public URL for a project's logo (served by brandingPublicRouter).
 * Cache-busted with unix seconds.
 */
export function brandingLogoPublicUrl(projectId: string): string {
  const v = Math.floor(Date.now() / 1000);
  return `${env.BRIVEN_API_ORIGIN}/v1/projects/${projectId}/auth/branding/logo?v=${v}`;
}

/**
 * Store (overwrite) the logo object in MinIO via Bun S3 write.
 */
export async function putBrandingLogo(input: {
  projectId: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<void> {
  const bare = input.contentType.split(';', 1)[0]!.trim().toLowerCase();
  const cfg = requireStorageEnv();
  const client = s3Client(cfg);
  const key = objectKey(input.projectId);
  try {
    // Prefer S3File.write (Bun docs); fall back to client.write if present.
    const file = client.file(key);
    await file.write(input.bytes, { type: bare });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`minio logo put failed: ${msg.slice(0, 200)}`);
  }
}

export interface BrandingLogoObject {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Fetch the stored logo. Returns null when missing.
 */
export async function getBrandingLogo(
  projectId: string,
): Promise<BrandingLogoObject | null> {
  const cfg = requireStorageEnv();
  const client = s3Client(cfg);
  const key = objectKey(projectId);
  const file = client.file(key);
  try {
    const exists = await file.exists();
    if (!exists) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType =
      (typeof file.type === 'string' && file.type) || 'application/octet-stream';
    return { bytes, contentType };
  } catch {
    return null;
  }
}

/**
 * Delete the stored logo. Idempotent.
 */
export async function deleteBrandingLogo(projectId: string): Promise<void> {
  const cfg = requireStorageEnv();
  const client = s3Client(cfg);
  const key = objectKey(projectId);
  try {
    const file = client.file(key);
    await file.delete();
  } catch {
    // Missing object is fine.
  }
}
