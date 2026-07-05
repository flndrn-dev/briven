import { createHmac } from 'node:crypto';

import { env } from '../env.js';

const MEDIA_BASE = 'https://media.briven.tech';
const MAX_DIM = 2000; // resize-bomb guard

export function isImageTransformConfigured(): boolean {
  return Boolean(env.BRIVEN_IMGPROXY_ENDPOINT && env.BRIVEN_IMGPROXY_KEY && env.BRIVEN_IMGPROXY_SALT);
}

export interface TransformOpts {
  width?: number;
  height?: number;
  resize?: 'fit' | 'fill' | 'auto';
}

/**
 * Build a signed imgproxy URL for a PUBLIC file. imgproxy fetches the source
 * from the public media URL, resizes, and returns it. The HMAC signature (key
 * + salt, both hex) stops attackers from requesting arbitrary transforms
 * (resize-bomb abuse). Dimensions are clamped to MAX_DIM.
 */
export function signedTransformUrl(projectId: string, fileId: string, opts: TransformOpts = {}): string {
  const endpoint = env.BRIVEN_IMGPROXY_ENDPOINT;
  const keyHex = env.BRIVEN_IMGPROXY_KEY;
  const saltHex = env.BRIVEN_IMGPROXY_SALT;
  if (!endpoint || !keyHex || !saltHex) {
    throw new Error('image transforms not configured');
  }
  const w = Math.min(Math.max(0, Math.floor(opts.width ?? 0)), MAX_DIM);
  const h = Math.min(Math.max(0, Math.floor(opts.height ?? 0)), MAX_DIM);
  const resize = opts.resize ?? 'fit';
  const source = `${MEDIA_BASE}/media/${projectId}/${fileId}`;
  const encodedSource = Buffer.from(source).toString('base64url');
  // imgproxy processing options: resize + gravity smart; extension omitted (keeps source format)
  const processing = `rs:${resize}:${w}:${h}:0/g:sm`;
  const path = `/${processing}/${encodedSource}`;
  const key = Buffer.from(keyHex, 'hex');
  const salt = Buffer.from(saltHex, 'hex');
  const hmac = createHmac('sha256', key);
  hmac.update(salt);
  hmac.update(path);
  const signature = hmac.digest('base64url');
  return `${endpoint.replace(/\/$/, '')}/${signature}${path}`;
}
