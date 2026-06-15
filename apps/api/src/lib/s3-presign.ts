import { S3Client } from 'bun';

/**
 * S3 presigning + listing, backed by Bun's native S3 client.
 *
 * Previously this file hand-rolled AWS Signature V4. That implementation was
 * untested and produced signatures MinIO rejected (SignatureDoesNotMatch on
 * every upload/list). Bun ships a battle-tested S3 client in the runtime, so
 * we delegate to it — no extra dependency, correct signatures against MinIO /
 * Garage / R2 / real S3. We construct a client per call because callers pass
 * different endpoints (internal `minio:9000` for server-side ops, the public
 * endpoint for browser-facing presigned URLs).
 */

export interface PresignInput {
  endpoint: string; // e.g. "https://s3.briven.tech" or "http://minio:9000"
  region: string; // e.g. "us-east-1"
  bucket: string;
  key: string; // object key, NOT url-encoded
  method: 'PUT' | 'GET' | 'DELETE';
  accessKey: string;
  secretKey: string;
  expiresIn: number; // seconds; max 604800 (7 days)
  /** For PUT — ties the Content-Type into the signed URL. */
  contentType?: string;
}

function clientFor(input: {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}): S3Client {
  return new S3Client({
    endpoint: input.endpoint,
    region: input.region,
    bucket: input.bucket,
    accessKeyId: input.accessKey,
    secretAccessKey: input.secretKey,
  });
}

export function presignS3Url(input: PresignInput): string {
  if (input.expiresIn < 1 || input.expiresIn > 604_800) {
    throw new Error('expiresIn must be 1..604800 seconds');
  }
  const client = clientFor(input);
  return client.presign(input.key, {
    method: input.method,
    expiresIn: input.expiresIn,
    ...(input.method === 'PUT' && input.contentType ? { type: input.contentType } : {}),
  });
}

export interface ListObjectsInput {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  prefix?: string;
  /** AWS caps at 1000 per request. */
  maxKeys?: number;
  /** Key to start after — used for pagination (Bun list is startAfter-based). */
  startAfter?: string;
}

export interface ListObjectsResult {
  objects: Array<{ key: string; lastModified: Date }>;
  isTruncated: boolean;
  /** Pass back as `startAfter` to fetch the next page; null when done. */
  nextStartAfter: string | null;
}

/**
 * List objects under a prefix. Replaces the old presign-a-list-URL + fetch +
 * regex-parse-XML dance — Bun's client does the signed request and parses the
 * response for us.
 */
export async function listObjects(input: ListObjectsInput): Promise<ListObjectsResult> {
  const client = clientFor(input);
  const res = await client.list({
    prefix: input.prefix,
    maxKeys: input.maxKeys,
    startAfter: input.startAfter,
  });
  const objects = (res.contents ?? []).map((o) => ({
    key: o.key,
    // Missing timestamp → treat as "now" so it's never mistaken for an old orphan.
    lastModified: new Date(o.lastModified ?? Date.now()),
  }));
  const isTruncated = Boolean(res.isTruncated);
  const nextStartAfter =
    isTruncated && objects.length > 0 ? (objects[objects.length - 1]?.key ?? null) : null;
  return { objects, isTruncated, nextStartAfter };
}
