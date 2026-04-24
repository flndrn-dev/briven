import { createHash, randomBytes } from 'node:crypto';

import { newId, NotFoundError } from '@briven/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { apiKeys, type ApiKey } from '../db/schema.js';

const KEY_PREFIX = 'brk'; // briven key — shown to the user, searchable in logs
const KEY_ENTROPY_BYTES = 32; // 256 bits

/**
 * Deploy / CLI keys. The plaintext is returned exactly once on creation;
 * only a SHA-256 hash is stored. A 4-char `suffix` is stored separately so
 * the dashboard can show a harmless hint like "brk_•••••ab12".
 */
export interface CreatedApiKey {
  record: ApiKey;
  plaintext: string;
}

export async function createApiKey(input: {
  projectId: string;
  createdBy: string;
  name: string;
  expiresAt?: Date;
}): Promise<CreatedApiKey> {
  const raw = randomBytes(KEY_ENTROPY_BYTES).toString('base64url');
  const plaintext = `${KEY_PREFIX}_${raw}`;
  const hash = createHash('sha256').update(plaintext).digest('hex');
  const suffix = plaintext.slice(-4);

  const db = getDb();
  const [record] = await db
    .insert(apiKeys)
    .values({
      id: newId('k'),
      projectId: input.projectId,
      createdBy: input.createdBy,
      name: input.name,
      hash,
      suffix,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  if (!record) throw new Error('api key insert returned no row');

  return { record, plaintext };
}

/**
 * Resolve a plaintext key to a project. Also bumps `last_used_at`.
 * Returns null if the key is invalid, revoked, or expired.
 */
export async function resolveApiKey(
  plaintext: string,
): Promise<{ projectId: string; keyId: string } | null> {
  const hash = createHash('sha256').update(plaintext).digest('hex');
  const db = getDb();
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.hash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  return { projectId: row.projectId, keyId: row.id };
}

export interface MaskedApiKey {
  id: string;
  name: string;
  suffix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export async function listApiKeysForProject(projectId: string): Promise<MaskedApiKey[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      suffix: apiKeys.suffix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.projectId, projectId))
    .orderBy(desc(apiKeys.createdAt));
  return rows;
}

export async function renameApiKey(projectId: string, keyId: string, name: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.projectId, projectId)))
    .limit(1);
  if (!row) throw new NotFoundError('api_key', keyId);
  if (row.revokedAt) return; // revoked keys are immutable
  await db.update(apiKeys).set({ name }).where(eq(apiKeys.id, keyId));
}

export async function revokeApiKey(projectId: string, keyId: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.projectId, projectId)))
    .limit(1);
  if (!row) throw new NotFoundError('api_key', keyId);
  if (row.revokedAt) return; // already revoked — idempotent
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, keyId));
}
