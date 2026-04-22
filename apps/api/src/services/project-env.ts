import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

import { newId, NotFoundError, ValidationError } from '@briven/shared';
import { and, eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { projectEnvVars } from '../db/schema.js';
import { env } from '../env.js';

/**
 * Per-project env vars. Values are encrypted at rest with AES-256-GCM. The
 * KEK is `BRIVEN_ENCRYPTION_KEY` — rotating it means reading every ciphertext
 * with the old key and re-writing with the new, handled by a Phase 3 rotate
 * script (not yet).
 *
 * IV format: `<12-byte-iv><16-byte-tag><ciphertext>`, base64-encoded.
 */

const KEY_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;

function key(): Buffer {
  const raw = env.BRIVEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new ValidationError('BRIVEN_ENCRYPTION_KEY is not configured');
  }
  // Accept either a raw 32-byte hex string OR any-length secret (hash it).
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return createHash('sha256').update(raw).digest();
}

export function encryptValue(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptValue(stored: string): string {
  const buf = Buffer.from(stored, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export interface MaskedEnvVar {
  id: string;
  key: string;
  lastFour: string;
  createdAt: Date;
  updatedAt: Date;
}

function mask(plaintext: string): string {
  return plaintext.length <= 4 ? plaintext : plaintext.slice(-4);
}

export async function listEnvForProject(projectId: string): Promise<MaskedEnvVar[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectEnvVars)
    .where(eq(projectEnvVars.projectId, projectId));
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    lastFour: mask(decryptValue(r.encryptedValue)),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function getPlainEnvForProject(projectId: string): Promise<Record<string, string>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectEnvVars)
    .where(eq(projectEnvVars.projectId, projectId));
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = decryptValue(r.encryptedValue);
  return out;
}

export async function upsertEnvVar(input: {
  projectId: string;
  key: string;
  value: string;
  createdBy: string | null;
}): Promise<void> {
  if (!KEY_RE.test(input.key)) {
    throw new ValidationError(
      'env var key must be uppercase letters, digits and underscores, starting with a letter or underscore',
      { key: input.key },
    );
  }
  const db = getDb();
  const encryptedValue = encryptValue(input.value);
  await db
    .insert(projectEnvVars)
    .values({
      id: newId('ev'),
      projectId: input.projectId,
      key: input.key,
      encryptedValue,
      createdBy: input.createdBy,
    })
    .onConflictDoUpdate({
      target: [projectEnvVars.projectId, projectEnvVars.key],
      set: { encryptedValue, updatedAt: new Date() },
    });
}

export async function deleteEnvVar(projectId: string, envVarId: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(projectEnvVars)
    .where(and(eq(projectEnvVars.id, envVarId), eq(projectEnvVars.projectId, projectId)))
    .limit(1);
  if (!row) throw new NotFoundError('env_var', envVarId);
  await db.delete(projectEnvVars).where(eq(projectEnvVars.id, envVarId));
}

export async function deleteEnvVarByKey(
  projectId: string,
  key: string,
): Promise<{ id: string; key: string }> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(projectEnvVars)
    .where(and(eq(projectEnvVars.key, key), eq(projectEnvVars.projectId, projectId)))
    .limit(1);
  if (!row) throw new NotFoundError('env_var', key);
  await db.delete(projectEnvVars).where(eq(projectEnvVars.id, row.id));
  return { id: row.id, key: row.key };
}
