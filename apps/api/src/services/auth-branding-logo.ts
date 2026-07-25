import { ValidationError } from '@briven/shared';

import { env } from '../env.js';
import { presignS3Url } from '../lib/s3-presign.js';
import { isStorageConfigured } from './storage.js';

/**
 * Storage + serving for auth → branding logos (briven-engine).
 *
 * Upload path (dashboard): POST /v1/auth-core/projects/:projectId/branding/logo
 * Public serve: GET /v1/projects/:id/auth/branding/logo (brandingPublicRouter)
 *
 * Object key: auth-branding/<projectId>/logo
 *
 * Uses the same SigV4 path as `services/storage.ts` (presign + fetch).
 * That path is proven against live MinIO; Bun S3File.write has been flaky
 * with SignatureDoesNotMatch when env/signing context drifts.
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

/**
 * When MinIO / Bun omits Content-Type (or returns application/octet-stream),
 * sniff from magic bytes so `<img>` can render. Browsers refuse images with
 * `nosniff` + `application/octet-stream`.
 */
export function sniffLogoContentType(
  bytes: Uint8Array,
  headerType?: string | null,
): string {
  const bare = (headerType ?? '').split(';', 1)[0]!.trim().toLowerCase();
  if ((ALLOWED_LOGO_TYPES as readonly string[]).includes(bare)) {
    return bare;
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  // SVG is text — look for <svg or <?xml…svg in the first 256 bytes.
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, Math.min(bytes.length, 256)))
    .toLowerCase();
  if (head.includes('<svg') || (head.includes('<?xml') && head.includes('svg'))) {
    return 'image/svg+xml';
  }
  return bare || 'application/octet-stream';
}

/**
 * Pure validator — unit-tested without any network/postgres. Throws a
 * `ValidationError` (400 at the route) on a disallowed content-type or an
 * over-cap / non-positive size.
 */
export function validateLogoUpload(input: {
  contentType: string;
  size: number;
}): void {
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
    throw new ValidationError(
      `logo exceeds the ${LOGO_MAX_BYTES} byte (1 MiB) cap`,
    );
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
 * Store (overwrite) the logo object in MinIO via signed PUT (same path as
 * project storage uploads).
 */
export async function putBrandingLogo(input: {
  projectId: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<void> {
  const bare = input.contentType.split(';', 1)[0]!.trim().toLowerCase();
  const cfg = requireStorageEnv();
  const key = objectKey(input.projectId);
  const url = presignS3Url({
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    key,
    method: 'PUT',
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
    expiresIn: 60,
    contentType: bare,
  });
  // Body must be a plain ArrayBuffer / Buffer — some runtimes mishandle
  // Uint8Array views when signing Content-Length / payload hash.
  const body = input.bytes.buffer.slice(
    input.bytes.byteOffset,
    input.bytes.byteOffset + input.bytes.byteLength,
  ) as ArrayBuffer;
  const res = await fetch(url, {
    method: 'PUT',
    body,
    headers: { 'content-type': bare },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `minio logo put failed: ${res.status} ${text.slice(0, 200)}`,
    );
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
  const url = presignS3Url({
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    key: objectKey(projectId),
    method: 'GET',
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
    expiresIn: 60,
  });
  const res = await fetch(url, { method: 'GET' });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `minio logo get failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }
  const headerType = res.headers.get('content-type');
  const bytes = new Uint8Array(await res.arrayBuffer());
  return {
    bytes,
    contentType: sniffLogoContentType(bytes, headerType),
  };
}

/**
 * Delete the stored logo. Idempotent.
 */
export async function deleteBrandingLogo(projectId: string): Promise<void> {
  const cfg = requireStorageEnv();
  const url = presignS3Url({
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    key: objectKey(projectId),
    method: 'DELETE',
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
    expiresIn: 60,
  });
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `minio logo delete failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }
}
