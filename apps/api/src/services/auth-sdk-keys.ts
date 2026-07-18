import { createHash, randomBytes } from 'node:crypto';

import { brivenError, newId, NotFoundError, ValidationError } from '@briven/shared';
import { and, desc, eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  brivenAuthSdkKeys,
  brivenAuthSdkKeyScope,
  type BrivenAuthSdkKey,
  type BrivenAuthSdkKeyScope,
} from '../db/schema.js';
import { decryptValue, encryptValue } from './project-env.js';

/**
 * SDK keys for briven auth — issued from the dashboard's Auth → API Keys
 * panel. Embedded in customer apps via `@briven/auth`'s `createBrivenAuth({
 * publicKey })`. Different from the CLI deploy keys in `services/api-keys.ts`:
 *
 *   - prefix `pk_briven_auth_` (recognisable in logs + grep + leaked-cred scans)
 *   - scope vocabulary `read | read-write | admin` instead of MemberRole
 *   - separate table (`briven_auth_sdk_keys`) so the deploy-key admin path
 *     and the SDK-key admin path don't share authorisation logic
 *
 * Plaintext is returned on creation and can be revealed later via the audited
 * copy-again path (AES-256-GCM `encrypted_key`, migration 0039). Auth
 * verification always uses the sha-256 `hash` only — leaking the dump without
 * the KEK still leaks zero usable keys for sign-in.
 */

const KEY_PREFIX = 'pk_briven_auth_';
const KEY_ENTROPY_BYTES = 32; // 256 bits
const NAME_MIN = 1;
const NAME_MAX = 64;

export function isAssignableSdkKeyScope(scope: string): scope is BrivenAuthSdkKeyScope {
  return (brivenAuthSdkKeyScope as readonly string[]).includes(scope);
}

export interface CreatedSdkKey {
  record: BrivenAuthSdkKey;
  /** The only place the plaintext ever exists outside the customer's clipboard. */
  plaintext: string;
}

export async function createAuthSdkKey(input: {
  projectId: string;
  createdBy: string;
  name: string;
  scope?: BrivenAuthSdkKeyScope;
  expiresAt?: Date;
}): Promise<CreatedSdkKey> {
  const name = input.name.trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    throw new ValidationError(`name must be ${NAME_MIN}-${NAME_MAX} chars`, { name });
  }
  const scope = input.scope ?? 'read';
  if (!isAssignableSdkKeyScope(scope)) {
    throw new ValidationError(
      `scope must be one of ${brivenAuthSdkKeyScope.join(' | ')}`,
      { scope },
    );
  }

  const random = randomBytes(KEY_ENTROPY_BYTES).toString('base64url');
  const plaintext = `${KEY_PREFIX}${random}`;
  const hash = createHash('sha256').update(plaintext).digest('hex');
  const suffix = plaintext.slice(-4);
  // Encrypt-at-rest for the audited "copy again" path. Hash remains the sole
  // verification mechanism; ciphertext is never used for auth.
  const encryptedKey = encryptValue(plaintext);

  const db = getDb();
  const [record] = await db
    .insert(brivenAuthSdkKeys)
    .values({
      id: newId('auk'),
      projectId: input.projectId,
      createdBy: input.createdBy,
      name,
      hash,
      encryptedKey,
      prefix: KEY_PREFIX,
      suffix,
      scope,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  if (!record) throw new Error('briven_auth_sdk_keys insert returned no row');

  return { record, plaintext };
}

export interface MaskedSdkKey {
  id: string;
  name: string;
  prefix: string;
  suffix: string;
  scope: BrivenAuthSdkKeyScope;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export async function listAuthSdkKeysForProject(projectId: string): Promise<MaskedSdkKey[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: brivenAuthSdkKeys.id,
      name: brivenAuthSdkKeys.name,
      prefix: brivenAuthSdkKeys.prefix,
      suffix: brivenAuthSdkKeys.suffix,
      scope: brivenAuthSdkKeys.scope,
      createdAt: brivenAuthSdkKeys.createdAt,
      lastUsedAt: brivenAuthSdkKeys.lastUsedAt,
      expiresAt: brivenAuthSdkKeys.expiresAt,
      revokedAt: brivenAuthSdkKeys.revokedAt,
    })
    .from(brivenAuthSdkKeys)
    .where(eq(brivenAuthSdkKeys.projectId, projectId))
    .orderBy(desc(brivenAuthSdkKeys.createdAt));
  return rows;
}

export async function revokeAuthSdkKey(projectId: string, keyId: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(brivenAuthSdkKeys)
    .where(and(eq(brivenAuthSdkKeys.id, keyId), eq(brivenAuthSdkKeys.projectId, projectId)))
    .limit(1);
  if (!row) throw new NotFoundError('briven_auth_sdk_key', keyId);
  if (row.revokedAt) return; // already revoked — idempotent
  await db
    .update(brivenAuthSdkKeys)
    .set({ revokedAt: new Date() })
    .where(eq(brivenAuthSdkKeys.id, keyId));
}

/**
 * Decrypt a stored SDK key for the audited "copy again" dashboard action.
 * Refuses revoked keys and pre-0039 rows with no ciphertext.
 */
export async function revealAuthSdkKey(
  projectId: string,
  keyId: string,
): Promise<{ plaintext: string }> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(brivenAuthSdkKeys)
    .where(and(eq(brivenAuthSdkKeys.id, keyId), eq(brivenAuthSdkKeys.projectId, projectId)))
    .limit(1);
  if (!row) throw new NotFoundError('briven_auth_sdk_key', keyId);
  if (row.revokedAt || !row.encryptedKey) {
    throw new brivenError('key_not_revealable', 'key cannot be revealed', { status: 404 });
  }
  return { plaintext: decryptValue(row.encryptedKey) };
}

/**
 * Resolve a plaintext SDK key to the project it belongs to. Used by the
 * runtime middleware that authenticates incoming SDK requests. Returns
 * null for unknown, revoked, or expired keys. Bumps `last_used_at` on hit.
 */
export async function resolveAuthSdkKey(
  plaintext: string,
): Promise<{ projectId: string; keyId: string; scope: BrivenAuthSdkKeyScope } | null> {
  if (!plaintext.startsWith(KEY_PREFIX)) return null;
  const hash = createHash('sha256').update(plaintext).digest('hex');
  const db = getDb();
  const [row] = await db
    .select()
    .from(brivenAuthSdkKeys)
    .where(eq(brivenAuthSdkKeys.hash, hash))
    .limit(1);
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

  await db
    .update(brivenAuthSdkKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(brivenAuthSdkKeys.id, row.id));
  return { projectId: row.projectId, keyId: row.id, scope: row.scope };
}

export { KEY_PREFIX as AUTH_SDK_KEY_PREFIX };
