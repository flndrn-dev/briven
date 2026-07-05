import { newId, NotFoundError, ValidationError } from '@briven/shared';
import { and, asc, eq, isNull, sql as drizzleSql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { projectFiles, type ProjectFile } from '../db/schema.js';
import { env } from '../env.js';
import { presignS3Url } from '../lib/s3-presign.js';
import { getProjectTier, TIERS, TierLimitExceeded } from './tiers.js';

/**
 * Per-project object storage. Each project's files live under the prefix
 * `projects/<projectId>/` inside the shared `briven` bucket. The API is
 * the only path that mints presigned PUT/GET URLs — clients never get
 * permanent S3 credentials.
 *
 * Two endpoints participate:
 *   - BRIVEN_MINIO_ENDPOINT — server-side traffic. `http://minio:9000`
 *     inside the Dokploy compose, or any reachable internal address.
 *   - BRIVEN_MINIO_PUBLIC_ENDPOINT — what the browser sees in presigned
 *     URLs. Must be HTTPS in production (`https://s3.briven.tech`).
 *
 * If only the internal endpoint is set, we fall back to it for both — fine
 * for dev where the browser can reach the same host as the server.
 */

const MAX_NAME_LEN = 200;
const MAX_CT_LEN = 100;
const MAX_BYTES = 1024 * 1024 * 1024; // 1 GiB per file (alpha cap)
const UPLOAD_URL_TTL = 600; // 10 min
const DOWNLOAD_URL_TTL = 300; // 5 min
const CT_RE = /^[a-zA-Z][a-zA-Z0-9!#$&^_+.\-/]{0,99}$/;

/**
 * Filename validator. Allows any printable unicode; rejects empty, any
 * byte < 0x20 (control chars — `no-control-regex` lint rule trips on a
 * regex spelling of this), and the forward slash (path-separator
 * confusion in URL routing).
 */
function isValidFilename(name: string): boolean {
  if (name.length === 0 || name.length > MAX_NAME_LEN) return false;
  for (let i = 0; i < name.length; i += 1) {
    const c = name.charCodeAt(i);
    if (c < 0x20) return false;
    if (c === 0x2f) return false;
  }
  return true;
}

interface StorageEnv {
  endpoint: string;
  publicEndpoint: string;
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
    publicEndpoint: env.BRIVEN_MINIO_PUBLIC_ENDPOINT ?? endpoint,
    region: env.BRIVEN_MINIO_REGION ?? 'us-east-1',
    bucket: env.BRIVEN_MINIO_BUCKET ?? 'briven',
    accessKey,
    secretKey,
  };
}

/**
 * Probe at boot — returns null silently if storage isn't configured, so
 * the rest of the API stays up. Callers (the routes) translate this into
 * a 503 / "not configured" error response.
 */
export function isStorageConfigured(): boolean {
  return Boolean(
    env.BRIVEN_MINIO_ENDPOINT && env.BRIVEN_MINIO_ACCESS_KEY && env.BRIVEN_MINIO_SECRET_KEY,
  );
}

export async function listFiles(projectId: string): Promise<ProjectFile[]> {
  const db = getDb();
  return db
    .select()
    .from(projectFiles)
    .where(and(eq(projectFiles.projectId, projectId), isNull(projectFiles.deletedAt)))
    .orderBy(asc(projectFiles.name));
}

export async function getFile(fileId: string, projectId: string): Promise<ProjectFile> {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectFiles)
    .where(
      and(
        eq(projectFiles.id, fileId),
        eq(projectFiles.projectId, projectId),
        isNull(projectFiles.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('file', fileId);
  return row;
}

export interface PresignUploadInput {
  projectId: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string | null;
}

export interface PresignUploadResult {
  file: ProjectFile;
  uploadUrl: string;
  // Echo back so the browser can include the same header it signed for.
  requiredHeaders: Record<string, string>;
  expiresInSec: number;
}

export async function presignUpload(input: PresignUploadInput): Promise<PresignUploadResult> {
  if (!isValidFilename(input.name)) {
    throw new ValidationError('filename contains invalid characters or is empty');
  }
  if (!CT_RE.test(input.contentType)) {
    throw new ValidationError('invalid content-type');
  }
  if (input.contentType.length > MAX_CT_LEN) {
    throw new ValidationError(`content-type exceeds ${MAX_CT_LEN} chars`);
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes < 0) {
    throw new ValidationError('sizeBytes must be a non-negative integer');
  }
  if (input.sizeBytes > MAX_BYTES) {
    throw new ValidationError(`file exceeds ${MAX_BYTES} byte upload cap`);
  }

  const cfg = requireStorageEnv();
  const fileId = newId('f');
  const objectKey = `projects/${input.projectId}/${fileId}`;

  const db = getDb();

  // Tier storage cap — hard-block over-quota uploads (M2). Sums this project's
  // live file bytes; refuses the presign if the new file would bust the tier cap.
  // Existing files stay readable — only the new upload is blocked. (Kept recovery
  // versions aren't counted yet; that arrives with the per-project bucket meter.)
  const tier = (await getProjectTier(input.projectId)) ?? 'free';
  const cap = TIERS[tier].storageBytes;
  const [usageRow] = await db
    .select({
      used: drizzleSql<number>`coalesce(sum(cast(${projectFiles.sizeBytes} as bigint)), 0)::bigint`,
    })
    .from(projectFiles)
    .where(and(eq(projectFiles.projectId, input.projectId), isNull(projectFiles.deletedAt)));
  const used = Number(usageRow?.used ?? 0);
  if (used + input.sizeBytes > cap) {
    throw new TierLimitExceeded(
      `storage full: ${used} + ${input.sizeBytes} bytes exceeds the '${tier}' tier cap of ${cap}`,
      { projectId: input.projectId, tier, used, incoming: input.sizeBytes, cap },
    );
  }

  const inserted = await db
    .insert(projectFiles)
    .values({
      id: fileId,
      projectId: input.projectId,
      name: input.name,
      objectKey,
      contentType: input.contentType,
      sizeBytes: String(input.sizeBytes),
      uploadedBy: input.uploadedBy,
    })
    .returning();
  const file = inserted[0];
  if (!file) throw new Error('file row insert returned nothing');

  const uploadUrl = presignS3Url({
    endpoint: cfg.publicEndpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    key: objectKey,
    method: 'PUT',
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
    expiresIn: UPLOAD_URL_TTL,
    contentType: input.contentType,
  });

  return {
    file,
    uploadUrl,
    requiredHeaders: { 'content-type': input.contentType },
    expiresInSec: UPLOAD_URL_TTL,
  };
}

export interface PresignDownloadResult {
  file: ProjectFile;
  downloadUrl: string;
  expiresInSec: number;
}

export async function presignDownload(
  fileId: string,
  projectId: string,
): Promise<PresignDownloadResult> {
  const file = await getFile(fileId, projectId);
  const cfg = requireStorageEnv();
  const downloadUrl = presignS3Url({
    endpoint: cfg.publicEndpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    key: file.objectKey,
    method: 'GET',
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
    expiresIn: DOWNLOAD_URL_TTL,
  });
  return { file, downloadUrl, expiresInSec: DOWNLOAD_URL_TTL };
}

export async function deleteFile(fileId: string, projectId: string): Promise<ProjectFile> {
  const file = await getFile(fileId, projectId);
  const cfg = requireStorageEnv();

  // Soft-delete the metadata row first. If the MinIO DELETE call below
  // fails, the file is no longer listable + the object key is uniquely
  // tied to this row so it'll never be reissued — a future janitor can
  // sweep orphaned objects safely.
  const db = getDb();
  await db
    .update(projectFiles)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(projectFiles.id, fileId), isNull(projectFiles.deletedAt)));

  // Server-side DELETE uses the INTERNAL endpoint (faster, doesn't bounce
  // through traefik) and the same sigv4 algorithm — just method=DELETE.
  const internalDeleteUrl = presignS3Url({
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    key: file.objectKey,
    method: 'DELETE',
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
    expiresIn: 60,
  });
  const res = await fetch(internalDeleteUrl, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    // 404 means already gone — fine. Anything else: leave the row
    // soft-deleted and surface the error so the operator notices.
    const body = await res.text().catch(() => '');
    throw new Error(`minio delete failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return { ...file, deletedAt: new Date() };
}

// Re-export for callers that want raw access (rare).
export { drizzleSql };
