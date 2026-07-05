import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { env } from '../env.js';
import { log } from '../lib/logger.js';

/**
 * MinIO admin helper — bucket + SCOPED service-account lifecycle for per-project
 * storage. Shells out to the official `mc` client (bundled into the api image),
 * which correctly handles MinIO's admin-API encryption we would otherwise have
 * to hand-roll. All calls use ARG-ARRAY spawn (no shell) so project data can't
 * inject a command.
 *
 * Auth: a temporary `MC_HOST_<alias>` env var carries the ROOT credentials to the
 * INTERNAL endpoint (http://minio:9000) — never written to disk, injected per
 * call. mc's config dir is redirected to a writable /tmp path.
 *
 * The scoped key is load-bearing security: because the parent (root `briven`)
 * has full admin, a service account created WITHOUT the inline policy silently
 * becomes a master key over every bucket. The two-statement single-bucket policy
 * below is what confines each customer key to its own bucket. (Verified against
 * MinIO's canonical policy-based-access-control docs.)
 */

const ALIAS = 'briven';
const MC_CONFIG_DIR = join(tmpdir(), '.mc-briven');

export function isMinioAdminConfigured(): boolean {
  return Boolean(
    env.BRIVEN_MINIO_ENDPOINT && env.BRIVEN_MINIO_ACCESS_KEY && env.BRIVEN_MINIO_SECRET_KEY,
  );
}

/** DNS-safe bucket name per project (mirrors dbNameFor's intent; hyphens, not underscores). */
export function bucketNameFor(projectId: string): string {
  const safe = projectId.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `proj-${safe}`.slice(0, 63);
}

function mcHostEnv(): Record<string, string> {
  const endpoint = env.BRIVEN_MINIO_ENDPOINT;
  const access = env.BRIVEN_MINIO_ACCESS_KEY;
  const secret = env.BRIVEN_MINIO_SECRET_KEY;
  if (!endpoint || !access || !secret) {
    throw new Error('minio admin not configured (BRIVEN_MINIO_ENDPOINT/ACCESS_KEY/SECRET_KEY)');
  }
  const u = new URL(endpoint);
  // MC_HOST_<alias> = scheme://access:secret@host — creds URL-encoded per mc docs.
  const hostSpec = `${u.protocol}//${encodeURIComponent(access)}:${encodeURIComponent(secret)}@${u.host}`;
  return {
    ...(process.env as Record<string, string>),
    [`MC_HOST_${ALIAS}`]: hostSpec,
    MC_CONFIG_DIR,
  };
}

async function runMc(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  await mkdir(MC_CONFIG_DIR, { recursive: true }).catch(() => {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proc = (globalThis as any).Bun.spawn(['mc', '--json', ...args], {
    env: mcHostEnv(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code: number = await proc.exited;
  return { code, stdout, stderr };
}

/** Create the project's bucket if absent + turn on versioning. Idempotent. */
export async function ensureBucket(bucket: string): Promise<void> {
  const r = await runMc(['mb', '--ignore-existing', `${ALIAS}/${bucket}`]);
  if (r.code !== 0) {
    throw new Error(`minio create bucket failed: ${(r.stderr || r.stdout).slice(0, 300)}`);
  }
  // Versioning = the recovery safety net: a delete/overwrite keeps the old
  // version so a file can be restored within the tier's recovery window.
  // Idempotent; a failure just means recovery isn't active (bucket still works).
  const v = await runMc(['version', 'enable', `${ALIAS}/${bucket}`]);
  if (v.code !== 0) {
    log.warn('minio_versioning_enable_failed', {
      bucket,
      err: (v.stderr || v.stdout).slice(0, 200),
    });
  }
}

/**
 * Expire OLD (noncurrent) versions after `days` — the tier's recovery window.
 * Keeps deleted/overwritten copies restorable for `days`, then MinIO reclaims
 * the space so recovery storage stays bounded (and priced into the tier cap).
 */
export async function setRecoveryLifecycle(bucket: string, days: number): Promise<void> {
  const window = String(Math.max(1, Math.floor(days)));
  const r = await runMc([
    'ilm',
    'rule',
    'add',
    `${ALIAS}/${bucket}`,
    '--noncurrent-expire-days',
    window,
  ]);
  if (r.code !== 0) {
    log.warn('minio_lifecycle_set_failed', {
      bucket,
      days,
      err: (r.stderr || r.stdout).slice(0, 200),
    });
  }
}

/**
 * Total bytes stored in a bucket, INCLUDING kept (noncurrent) versions so the
 * recovery copies count toward quota. Falls back to current-only if the
 * `--versions` flag isn't supported. Returns 0 if it can't be read.
 */
export async function bucketUsageBytes(bucket: string): Promise<number> {
  let r = await runMc(['du', '--versions', `${ALIAS}/${bucket}`]);
  if (r.code !== 0) r = await runMc(['du', `${ALIAS}/${bucket}`]);
  if (r.code !== 0) return 0;
  // mc --json du emits one JSON object per line; take the last size seen.
  let bytes = 0;
  for (const line of r.stdout.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as { size?: number };
      if (typeof o.size === 'number') bytes = o.size;
    } catch {
      // skip non-JSON lines
    }
  }
  return bytes;
}

function singleBucketPolicy(bucket: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['s3:ListBucket', 's3:GetBucketLocation', 's3:ListBucketMultipartUploads'],
        Resource: [`arn:aws:s3:::${bucket}`],
      },
      {
        Effect: 'Allow',
        Action: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:AbortMultipartUpload',
          's3:ListMultipartUploadParts',
        ],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  });
}

export interface ScopedKey {
  accessKey: string;
  secretKey: string;
}

/**
 * Mint a service-account key scoped to ONE bucket. We generate the access/secret
 * ourselves (so no fragile JSON-lines parsing of mc output) and pin the inline
 * policy via a temp FILE (mc's --policy takes a path, not a string).
 */
export async function createScopedKey(input: { bucket: string; name: string }): Promise<ScopedKey> {
  const accessKey = `brvn${randomBytes(8).toString('hex')}`; // 20 chars, alphanumeric
  const secretKey = randomBytes(30).toString('base64url'); // ~40 chars
  const policyPath = join(MC_CONFIG_DIR, `pol-${randomBytes(6).toString('hex')}.json`);
  await mkdir(MC_CONFIG_DIR, { recursive: true }).catch(() => {});
  await writeFile(policyPath, singleBucketPolicy(input.bucket), 'utf8');
  try {
    const r = await runMc([
      'admin',
      'user',
      'svcacct',
      'add',
      ALIAS,
      env.BRIVEN_MINIO_ACCESS_KEY ?? ALIAS,
      '--access-key',
      accessKey,
      '--secret-key',
      secretKey,
      '--name',
      input.name.slice(0, 32), // MinIO hard limit: service-account name <= 32 chars
      '--policy',
      policyPath,
    ]);
    if (r.code !== 0) {
      throw new Error(`minio svcacct add failed: ${(r.stderr || r.stdout).slice(0, 300)}`);
    }
  } finally {
    await unlink(policyPath).catch(() => {});
  }
  log.info('minio_scoped_key_created', { bucket: input.bucket, accessKey });
  return { accessKey, secretKey };
}

export type RestoreResult = 'restored' | 'nothing-to-restore' | 'expired' | 'error';

/**
 * "Undelete" an object in a versioned bucket by removing its latest delete
 * marker, exposing the prior (non-current) version as current again.
 * - 'restored'            — delete marker removed, prior version live again
 * - 'nothing-to-restore'  — object isn't delete-marked (already live / absent)
 * - 'expired'             — only a delete marker survives; the data version was
 *                           already reclaimed by the recovery lifecycle
 * - 'error'               — the mc call failed
 */
export async function restoreObject(bucket: string, key: string): Promise<RestoreResult> {
  const r = await runMc(['ls', '--versions', `${ALIAS}/${bucket}/${key}`]);
  if (r.code !== 0) return 'error';
  let deleteMarkerId: string | null = null;
  let hasDataVersion = false;
  for (const line of r.stdout.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as { versionId?: string; isDeleteMarker?: boolean; isLatest?: boolean };
      if (o.isDeleteMarker) {
        if (o.isLatest && o.versionId) deleteMarkerId = o.versionId;
      } else if (o.versionId) {
        hasDataVersion = true;
      }
    } catch {
      // skip non-JSON lines
    }
  }
  if (!deleteMarkerId) return 'nothing-to-restore';
  if (!hasDataVersion) return 'expired';
  const rm = await runMc(['rm', '--version-id', deleteMarkerId, `${ALIAS}/${bucket}/${key}`]);
  return rm.code === 0 ? 'restored' : 'error';
}

/** Delete a scoped key (idempotent — a missing key is a no-op). */
export async function removeScopedKey(accessKey: string): Promise<void> {
  const r = await runMc(['admin', 'user', 'svcacct', 'rm', ALIAS, accessKey]);
  const out = `${r.stderr}${r.stdout}`;
  if (r.code !== 0 && !/does not exist|not found|no such/i.test(out)) {
    throw new Error(`minio svcacct rm failed: ${out.slice(0, 300)}`);
  }
  log.info('minio_scoped_key_removed', { accessKey });
}
