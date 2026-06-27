import { ValidationError } from '@briven/shared';

import { env } from '../env.js';
import { presignS3Url } from '../lib/s3-presign.js';
import { isStorageConfigured } from './storage.js';

/**
 * Storage + serving for auth → branding logos.
 *
 * Logos must render on PUBLIC hosted login pages, so neither presigned
 * (expiring) URLs nor bucket-policy changes are suitable. Instead we keep
 * the object PRIVATE in MinIO at a STABLE key and serve it back through an
 * UNAUTHENTICATED api route (`GET /v1/projects/:id/auth/branding/logo`)
 * that acts like a tiny CDN. The branding config's `logoUrl` then points
 * at that route (cache-busted), so the value is a permanent public URL.
 *
 * Object key is stable + overwritten on every upload:
 *   auth-branding/<projectId>/logo
 *
 * We reuse the same SigV4 signing path as `services/storage.ts`
 * (`lib/s3-presign.ts` → Bun's native S3 client) rather than constructing
 * a second S3 client. The content-type set on PUT round-trips through
 * MinIO natively and is read back off the GET response, so we don't need a
 * separate metadata sidecar.
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

/**
 * Read MinIO config from env. Mirrors the private `requireStorageEnv` in
 * `services/storage.ts` (not exported there); the env vars are the shared
 * source of truth. Server-side ops use the INTERNAL endpoint — these
 * fetches never leave the api host, so they don't bounce through traefik.
 */
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

/** Re-export so the route can return a `503 not_configured` cleanly. */
export { isStorageConfigured };

function objectKey(projectId: string): string {
  return `auth-branding/${projectId}/logo`;
}

/**
 * Pure validator — unit-tested without any network/postgres. Throws a
 * `ValidationError` (400 at the route) on a disallowed content-type or an
 * over-cap / non-positive size.
 */
export function validateLogoUpload(input: { contentType: string; size: number }): void {
  // Normalise: a browser may append `; charset=...` for svg. Compare the
  // bare media type so `image/svg+xml; charset=utf-8` still validates.
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
 * Build the STABLE public URL for a project's logo, cache-busted with the
 * current unix-seconds so a re-upload busts browser + edge caches. This is
 * what gets stored in `branding.logoUrl`. Points at the public serve route
 * on the api origin (world-readable; no auth).
 */
export function brandingLogoPublicUrl(projectId: string): string {
  const v = Math.floor(Date.now() / 1000);
  return `${env.BRIVEN_API_ORIGIN}/v1/projects/${projectId}/auth/branding/logo?v=${v}`;
}

/**
 * Store (overwrite) the logo object in MinIO. The content-type is tied
 * into the signed PUT and persisted on the object, so the serve route can
 * hand it straight back.
 */
export async function putBrandingLogo(input: {
  projectId: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<void> {
  const bare = input.contentType.split(';', 1)[0]!.trim().toLowerCase();
  const cfg = requireStorageEnv();
  const url = presignS3Url({
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    key: objectKey(input.projectId),
    method: 'PUT',
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
    expiresIn: 60,
    contentType: bare,
  });
  const res = await fetch(url, {
    method: 'PUT',
    body: input.bytes,
    headers: { 'content-type': bare },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`minio logo put failed: ${res.status} ${body.slice(0, 200)}`);
  }
}

export interface BrandingLogoObject {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Fetch the stored logo. Returns `null` when the object does not exist
 * (so the route can 404). The content-type comes back off MinIO's GET
 * response — the same value set on PUT.
 */
export async function getBrandingLogo(projectId: string): Promise<BrandingLogoObject | null> {
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
  if (res.status === 404 || res.status === 403) {
    // MinIO returns 404 for a missing key; some configs 403 on a missing
    // object. Either way: treat as "no logo".
    return null;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`minio logo get failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, contentType };
}

/**
 * Delete the stored logo. Idempotent — a missing object (404) is success,
 * mirroring `services/storage.ts:deleteFile`.
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
    const body = await res.text().catch(() => '');
    throw new Error(`minio logo delete failed: ${res.status} ${body.slice(0, 200)}`);
  }
}
