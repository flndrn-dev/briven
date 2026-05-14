import { and, isNotNull, lt } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { projectFiles, type ProjectFile } from '../db/schema.js';
import { env } from '../env.js';
import { presignS3Url } from '../lib/s3-presign.js';
import { log } from '../lib/logger.js';

/**
 * Storage orphan janitor. Soft-deleted `project_files` rows expect their
 * MinIO object to be deleted at soft-delete time (services/storage.ts
 * deleteFile path), but if that synchronous DELETE failed (network blip,
 * minio outage, transient 5xx) the object lingers forever — storage
 * leak in proportion to the failure rate × time.
 *
 * Every JANITOR_TICK_MS the worker:
 *   1. selects up to BATCH_SIZE rows where deleted_at < now - 1h (the
 *      1h grace gives the synchronous delete time to succeed or fail
 *      visibly before the janitor steps in).
 *   2. for each: signs a DELETE against MinIO and fires it. MinIO's
 *      DELETE is idempotent — 204 whether the object existed or not —
 *      so a no-op retry is cheap. Any 5xx is logged and the row gets
 *      another chance on the next tick.
 *
 * What this DOESN'T cover: objects in MinIO whose row got cascade-
 * deleted via project FK (hard-delete of a project removes its
 * project_files rows but not the underlying objects). That requires a
 * bucket LIST + reconcile path, which is a separate slice — the
 * sigv4 helper only signs PUT/GET/DELETE today.
 */

const JANITOR_TICK_MS = 6 * 60 * 60 * 1000;
const BATCH_SIZE = 200;
const GRACE_MS = 60 * 60 * 1000; // 1h after deleted_at before we sweep

let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;

interface StorageEnv {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

function storageEnv(): StorageEnv | null {
  if (
    !env.BRIVEN_MINIO_ENDPOINT ||
    !env.BRIVEN_MINIO_ACCESS_KEY ||
    !env.BRIVEN_MINIO_SECRET_KEY
  ) {
    return null;
  }
  return {
    endpoint: env.BRIVEN_MINIO_ENDPOINT,
    region: env.BRIVEN_MINIO_REGION ?? 'us-east-1',
    bucket: env.BRIVEN_MINIO_BUCKET ?? 'briven',
    accessKey: env.BRIVEN_MINIO_ACCESS_KEY,
    secretKey: env.BRIVEN_MINIO_SECRET_KEY,
  };
}

async function tick(): Promise<void> {
  if (inflight) {
    log.warn('storage_janitor_tick_skipped_inflight');
    return;
  }
  const cfg = storageEnv();
  if (!cfg) return; // storage not configured — silent no-op
  inflight = true;
  try {
    const cutoff = new Date(Date.now() - GRACE_MS);
    const db = getDb();
    const rows = await db
      .select()
      .from(projectFiles)
      .where(and(isNotNull(projectFiles.deletedAt), lt(projectFiles.deletedAt, cutoff)))
      .limit(BATCH_SIZE);
    if (rows.length === 0) return;
    log.info('storage_janitor_tick', { candidateCount: rows.length });

    let purged = 0;
    let failed = 0;
    await Promise.all(
      rows.map(async (row) => {
        const ok = await purgeObject(cfg, row);
        if (ok) purged += 1;
        else failed += 1;
      }),
    );
    if (purged > 0 || failed > 0) {
      log.info('storage_janitor_pass', { purged, failed });
    }
  } catch (err) {
    log.error('storage_janitor_tick_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inflight = false;
  }
}

async function purgeObject(cfg: StorageEnv, row: ProjectFile): Promise<boolean> {
  const url = presignS3Url({
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    key: row.objectKey,
    method: 'DELETE',
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
    expiresIn: 60,
  });
  try {
    const res = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(10_000) });
    if (res.status === 204 || res.status === 404) return true;
    // 5xx / 403 / anything else: log + leave for next tick
    log.warn('storage_janitor_object_not_purged', {
      fileId: row.id,
      objectKey: row.objectKey,
      status: res.status,
    });
    return false;
  } catch (err) {
    log.warn('storage_janitor_object_delete_failed', {
      fileId: row.id,
      objectKey: row.objectKey,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export function startStorageJanitor(): void {
  if (timer) return;
  if (!env.BRIVEN_DATABASE_URL) {
    log.warn('storage_janitor_skipped_no_db');
    return;
  }
  // 120s after boot — last in the worker startup cascade (schedule 45,
  // webhook-retention 90, outbound-retention 105, janitor 120). Keeps
  // the boot-time connection-pool burst smooth.
  setTimeout(() => {
    void tick();
    timer = setInterval(() => {
      void tick();
    }, JANITOR_TICK_MS);
  }, 120_000).unref?.();
  log.info('storage_janitor_armed', { tickMs: JANITOR_TICK_MS, batch: BATCH_SIZE });
}

export function stopStorageJanitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export const _internals = { tick, purgeObject };
