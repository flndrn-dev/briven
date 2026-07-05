import { newId, NotFoundError } from '@briven/shared';
import { and, eq, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { storageKeys } from '../db/schema.js';
import { log } from '../lib/logger.js';
import {
  bucketNameFor,
  createScopedKey,
  ensureBucket,
  isMinioAdminConfigured,
  removeScopedKey,
} from './minio-admin.js';

/**
 * Per-project storage keys — mint a bucket-scoped S3 service-account key a
 * customer can plug into any S3 tool. The secret is returned ONCE at creation
 * and never stored (MinIO holds it); we keep only the access-key id + metadata,
 * so revoke = remove the MinIO service account + mark the row.
 *
 * The control-plane table is created idempotently on first use (same pattern as
 * auth-origin-allowlist) so no drizzle migration/snapshot is needed.
 */

let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await getDb().execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS "storage_keys" (
        "id" text PRIMARY KEY NOT NULL,
        "project_id" text NOT NULL,
        "name" text NOT NULL,
        "access_key_id" text NOT NULL,
        "suffix" varchar(4) NOT NULL,
        "bucket" text NOT NULL,
        "enabled" boolean DEFAULT true NOT NULL,
        "created_by" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "revoked_at" timestamp with time zone
      )`,
    ),
  );
  await getDb().execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS "storage_keys_access_key_idx" ON "storage_keys" ("access_key_id")`,
    ),
  );
  await getDb().execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS "storage_keys_project_idx" ON "storage_keys" ("project_id")`),
  );
  tableReady = true;
}

export interface StorageKeyRecord {
  id: string;
  name: string;
  accessKeyId: string;
  suffix: string;
  bucket: string;
  enabled: boolean;
  createdAt: string;
  revokedAt: string | null;
}

export interface CreatedStorageKey {
  record: StorageKeyRecord;
  /** Full S3 credentials — returned ONCE, never stored. */
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

function toRecord(r: {
  id: string;
  name: string;
  accessKeyId: string;
  suffix: string;
  bucket: string;
  enabled: boolean;
  createdAt: Date;
  revokedAt: Date | null;
}): StorageKeyRecord {
  return {
    id: r.id,
    name: r.name,
    accessKeyId: r.accessKeyId,
    suffix: r.suffix,
    bucket: r.bucket,
    enabled: r.enabled,
    createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
    revokedAt: r.revokedAt
      ? (r.revokedAt instanceof Date ? r.revokedAt : new Date(r.revokedAt)).toISOString()
      : null,
  };
}

export async function listStorageKeys(projectId: string): Promise<StorageKeyRecord[]> {
  await ensureTable();
  const rows = await getDb().select().from(storageKeys).where(eq(storageKeys.projectId, projectId));
  return rows.map(toRecord).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createStorageKey(input: {
  projectId: string;
  name: string;
  createdBy: string | null;
  publicEndpoint: string;
}): Promise<CreatedStorageKey> {
  if (!isMinioAdminConfigured()) {
    throw new NotFoundError('storage', 'object storage is not configured on this api');
  }
  await ensureTable();
  const bucket = bucketNameFor(input.projectId);
  await ensureBucket(bucket);
  const { accessKey, secretKey } = await createScopedKey({
    bucket,
    name: `${input.projectId}:${input.name}`,
  });
  const suffix = secretKey.slice(-4);
  const row = {
    id: newId('sk'),
    projectId: input.projectId,
    name: input.name,
    accessKeyId: accessKey,
    suffix,
    bucket,
    createdBy: input.createdBy,
  };
  await getDb().insert(storageKeys).values(row);
  log.info('storage_key_created', { projectId: input.projectId, bucket, accessKey });
  return {
    record: {
      id: row.id,
      name: row.name,
      accessKeyId: accessKey,
      suffix,
      bucket,
      enabled: true,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    },
    endpoint: input.publicEndpoint,
    bucket,
    accessKey,
    secretKey,
  };
}

export async function revokeStorageKey(projectId: string, keyId: string): Promise<void> {
  await ensureTable();
  const db = getDb();
  const [row] = await db
    .select({ accessKeyId: storageKeys.accessKeyId })
    .from(storageKeys)
    .where(and(eq(storageKeys.id, keyId), eq(storageKeys.projectId, projectId)))
    .limit(1);
  if (!row) throw new NotFoundError('storage_key', keyId);
  await removeScopedKey(row.accessKeyId);
  await db
    .update(storageKeys)
    .set({ enabled: false, revokedAt: new Date() })
    .where(and(eq(storageKeys.id, keyId), eq(storageKeys.projectId, projectId)));
  log.info('storage_key_revoked', { projectId, keyId, accessKey: row.accessKeyId });
}
