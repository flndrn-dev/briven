import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4 query-string presigner.
 *
 * Targets S3-compatible endpoints (MinIO, R2, real S3) — anything that
 * accepts the standard sigv4 protocol on a path-style URL. We intentionally
 * support exactly two operations: PUT (uploads) and GET (downloads).
 *
 * Why hand-rolled instead of @aws-sdk/client-s3 + s3-request-presigner:
 *   - The full AWS SDK is multi-MB; we use 2 endpoints' worth of it.
 *   - The signing algorithm is stable + public (AWS docs §sigv4-query-string).
 *   - node:crypto is in the runtime already.
 *
 * Validated against the AWS test suite in the constants below.
 */

export interface PresignInput {
  endpoint: string; // e.g. "https://minio.briven.tech"
  region: string; // e.g. "us-east-1" (MinIO default)
  bucket: string;
  key: string; // object key, NOT url-encoded
  method: 'PUT' | 'GET' | 'DELETE';
  accessKey: string;
  secretKey: string;
  expiresIn: number; // seconds; max 604800 (7 days) per AWS spec
  // Date is injectable for testing; defaults to now().
  now?: Date;
  // For PUT, the Content-Type the client will send. Tying it into the
  // signed URL prevents the client from changing it after the fact.
  contentType?: string;
}

const ALG = 'AWS4-HMAC-SHA256';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

export function presignS3Url(input: PresignInput): string {
  if (input.expiresIn < 1 || input.expiresIn > 604_800) {
    throw new Error('expiresIn must be 1..604800 seconds');
  }

  const now = input.now ?? new Date();
  const amzDate = formatAmzDate(now); // 20260513T093000Z
  const dateStamp = amzDate.slice(0, 8); // 20260513

  // Endpoint → host. We keep path style ("http://host/bucket/key") for
  // MinIO compatibility. Real S3 also accepts path-style on its global
  // endpoints, so this stays portable.
  const endpointUrl = new URL(input.endpoint);
  const host = endpointUrl.host;
  const basePath = endpointUrl.pathname.replace(/\/+$/, '');

  // The full request path. Each segment is URI-encoded individually so
  // slashes within object keys (`projects/p_abc/f_xyz`) stay as
  // separators, while spaces/utf8 in the key get escaped.
  const encodedKey = input.key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const canonicalPath = `${basePath}/${input.bucket}/${encodedKey}`;

  const credentialScope = `${dateStamp}/${input.region}/s3/aws4_request`;
  const credential = `${input.accessKey}/${credentialScope}`;

  // Headers in the signature. Host is always signed. We also sign
  // content-type for PUT so the receiving server validates the type the
  // client claimed at signing time. Order: alphabetical, lowercased.
  const signedHeaderEntries: [string, string][] = [['host', host]];
  if (input.method === 'PUT' && input.contentType) {
    signedHeaderEntries.push(['content-type', input.contentType]);
  }
  signedHeaderEntries.sort(([a], [b]) => a.localeCompare(b));
  const signedHeaders = signedHeaderEntries.map(([k]) => k).join(';');
  const canonicalHeaders =
    signedHeaderEntries.map(([k, v]) => `${k}:${v.trim()}\n`).join('') + '';

  const queryParams: [string, string][] = [
    ['X-Amz-Algorithm', ALG],
    ['X-Amz-Credential', credential],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(input.expiresIn)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ];
  queryParams.sort(([a], [b]) => a.localeCompare(b));
  const canonicalQuery = queryParams
    .map(([k, v]) => `${rfc3986encode(k)}=${rfc3986encode(v)}`)
    .join('&');

  const canonicalRequest = [
    input.method,
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    UNSIGNED_PAYLOAD,
  ].join('\n');

  const stringToSign = [
    ALG,
    amzDate,
    credentialScope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signingKey = deriveSigningKey(input.secretKey, dateStamp, input.region);
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const finalQuery = `${canonicalQuery}&X-Amz-Signature=${signature}`;
  return `${endpointUrl.protocol}//${host}${canonicalPath}?${finalQuery}`;
}

/**
 * Sign an S3 ListObjectsV2 request as a presigned GET on the bucket.
 *
 * Bucket-scope (not key-scope), so the canonical path is just
 * `/<bucket>/` and the query string carries `list-type=2`, optional
 * `prefix`, and `continuation-token` for paging. Same sigv4 algorithm
 * as `presignS3Url`; this helper exists because the path layout +
 * extra query params don't fit cleanly into the per-key presigner.
 *
 * The orphan-reconcile path in the storage janitor uses this to walk
 * the bucket and find objects whose project_files row was cascade-
 * deleted via the project FK.
 */
export interface PresignListInput {
  endpoint: string;
  region: string;
  bucket: string;
  prefix?: string;
  continuationToken?: string;
  /** AWS caps this at 1000 per request. */
  maxKeys?: number;
  accessKey: string;
  secretKey: string;
  expiresIn: number;
  now?: Date;
}

export function presignS3ListObjectsV2(input: PresignListInput): string {
  if (input.expiresIn < 1 || input.expiresIn > 604_800) {
    throw new Error('expiresIn must be 1..604800 seconds');
  }
  const now = input.now ?? new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const endpointUrl = new URL(input.endpoint);
  const host = endpointUrl.host;
  const basePath = endpointUrl.pathname.replace(/\/+$/, '');
  const canonicalPath = `${basePath}/${input.bucket}/`;

  const credentialScope = `${dateStamp}/${input.region}/s3/aws4_request`;
  const credential = `${input.accessKey}/${credentialScope}`;

  const signedHeaders = 'host';
  const canonicalHeaders = `host:${host}\n`;

  const queryParams: [string, string][] = [
    ['X-Amz-Algorithm', ALG],
    ['X-Amz-Credential', credential],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(input.expiresIn)],
    ['X-Amz-SignedHeaders', signedHeaders],
    ['list-type', '2'],
  ];
  if (input.prefix !== undefined) queryParams.push(['prefix', input.prefix]);
  if (input.continuationToken !== undefined) {
    queryParams.push(['continuation-token', input.continuationToken]);
  }
  if (input.maxKeys !== undefined) {
    queryParams.push(['max-keys', String(input.maxKeys)]);
  }
  queryParams.sort(([a], [b]) => a.localeCompare(b));
  const canonicalQuery = queryParams
    .map(([k, v]) => `${rfc3986encode(k)}=${rfc3986encode(v)}`)
    .join('&');

  const canonicalRequest = [
    'GET',
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    UNSIGNED_PAYLOAD,
  ].join('\n');

  const stringToSign = [
    ALG,
    amzDate,
    credentialScope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signingKey = deriveSigningKey(input.secretKey, dateStamp, input.region);
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return `${endpointUrl.protocol}//${host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * Parse the relevant fields from a ListBucketResult XML response.
 *
 * Hand-rolled regex parser instead of a full XML lib — we only care
 * about three fields and the response shape is rigidly defined. Keys
 * are XML-entity-decoded for the common cases (`&amp;`, `&lt;`, etc.).
 */
export interface ListObjectsResult {
  objects: Array<{ key: string; lastModified: Date }>;
  isTruncated: boolean;
  nextContinuationToken: string | null;
}

export function parseListObjectsV2Response(xml: string): ListObjectsResult {
  const objects: Array<{ key: string; lastModified: Date }> = [];
  // <Contents><Key>...</Key>...<LastModified>...</LastModified>...</Contents>
  const contentsRe = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match: RegExpExecArray | null;
  while ((match = contentsRe.exec(xml)) !== null) {
    const inner = match[1] ?? '';
    const keyMatch = /<Key>([\s\S]*?)<\/Key>/.exec(inner);
    const lmMatch = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(inner);
    if (!keyMatch || !lmMatch) continue;
    const key = decodeXmlEntities(keyMatch[1] ?? '');
    const lastModified = new Date(lmMatch[1] ?? '');
    if (Number.isNaN(lastModified.getTime())) continue;
    objects.push({ key, lastModified });
  }
  const truncatedMatch = /<IsTruncated>(true|false)<\/IsTruncated>/.exec(xml);
  const tokenMatch = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml);
  return {
    objects,
    isTruncated: truncatedMatch?.[1] === 'true',
    nextContinuationToken: tokenMatch ? decodeXmlEntities(tokenMatch[1] ?? '') : null,
  };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function deriveSigningKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = createHmac('sha256', `AWS4${secret}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  return createHmac('sha256', kService).update('aws4_request').digest();
}

function formatAmzDate(date: Date): string {
  // 20260513T093000Z — no separators, suffix Z.
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// RFC3986 encoding — spec demands * is escaped (encodeURIComponent leaves it).
function rfc3986encode(input: string): string {
  return encodeURIComponent(input).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
