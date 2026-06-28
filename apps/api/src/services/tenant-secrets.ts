import { newId } from '@briven/shared';
import { and, eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { tenantSecrets } from '../db/schema.js';

import {
  decryptTenantSecret,
  encryptTenantSecret,
  type TenantService,
} from './tenant-secret-store.js';

/**
 * Persistence layer for per-tenant encrypted secrets (OAuth client secrets,
 * mittera API keys, webhook signing keys). The crypto lives in
 * `tenant-secret-store.ts` (HKDF-SHA256 per-tenant key + AES-256-GCM); this
 * file is the store-it / read-it helper around it, backed by the
 * control-plane `tenant_secrets` table.
 *
 * Identity is the (projectId, service, name) triple — the same namespace the
 * encryption is scoped to. `service` ('auth' | 'pay') keeps the two briven
 * services' secrets isolated without separate tables. Plaintext never lands
 * in the database and `hasTenantSecret` never decrypts.
 */

// Re-export so callers can type their `service` argument without reaching
// into the crypto primitive directly.
export type { TenantService } from './tenant-secret-store.js';

/**
 * Store (or overwrite) a secret. Encrypts the plaintext via
 * `encryptTenantSecret`, then UPSERTs keyed by (projectId, service, name).
 * `createdBy` is recorded on insert only — an overwrite leaves the original
 * actor in place and just refreshes `encryptedValue` + `updatedAt`.
 *
 * Control plane is Postgres 17, so `onConflictDoUpdate` is available (unlike
 * the DoltGres data plane which needs a manual insert-then-update emulation).
 */
export async function setTenantSecret(
  projectId: string,
  service: TenantService,
  name: string,
  plaintext: string,
  createdBy?: string | null,
): Promise<void> {
  const db = getDb();
  const encryptedValue = encryptTenantSecret({ service, projectId, plaintext });
  await db
    .insert(tenantSecrets)
    .values({
      id: newId('tsec'),
      projectId,
      service,
      name,
      encryptedValue,
      createdBy: createdBy ?? null,
    })
    .onConflictDoUpdate({
      target: [tenantSecrets.projectId, tenantSecrets.service, tenantSecrets.name],
      set: { encryptedValue, updatedAt: new Date() },
    });
}

/**
 * Read and decrypt a secret. Returns the plaintext, or `null` when no row
 * exists for the (projectId, service, name) triple.
 */
export async function getTenantSecret(
  projectId: string,
  service: TenantService,
  name: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(tenantSecrets)
    .where(
      and(
        eq(tenantSecrets.projectId, projectId),
        eq(tenantSecrets.service, service),
        eq(tenantSecrets.name, name),
      ),
    )
    .limit(1);
  if (!row) return null;
  return decryptTenantSecret({ service, projectId, ciphertext: row.encryptedValue });
}

/**
 * Presence check only — returns whether a secret exists for the
 * (projectId, service, name) triple. NEVER reads or decrypts the
 * ciphertext, so it's safe on a hot path that only needs the "is it
 * configured?" answer.
 */
export async function hasTenantSecret(
  projectId: string,
  service: TenantService,
  name: string,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: tenantSecrets.id })
    .from(tenantSecrets)
    .where(
      and(
        eq(tenantSecrets.projectId, projectId),
        eq(tenantSecrets.service, service),
        eq(tenantSecrets.name, name),
      ),
    )
    .limit(1);
  return row !== undefined;
}
