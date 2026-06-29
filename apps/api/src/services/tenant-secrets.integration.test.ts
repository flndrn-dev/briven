/**
 * Per-tenant secret persistence (Phase 3) — control plane `tenant_secrets`.
 *
 * Exercises the store/read helper (services/tenant-secrets.ts) end-to-end
 * against the REAL `tenant_secrets` table that migration 0043 finally created
 * (it was orphaned — see 0043_tenant_secrets.sql). This backs the Phase-3 auth
 * product's per-tenant OAuth client-secret storage.
 *
 * Proves:
 *   - set → get round-trips the plaintext (encrypt-on-write, decrypt-on-read);
 *   - what actually lands in the column is ciphertext, NOT the plaintext;
 *   - overwrite refreshes the value (UPSERT on the project/service/name triple);
 *   - hasTenantSecret is a presence check; missing reads return null;
 *   - the `service` namespace isolates 'auth' from 'pay' (same name, no bleed).
 *
 * Integration test (real control Postgres, no mock.module). Gated on
 * BRIVEN_DATA_PLANE_URL — the repo's "integration mode is on" signal. The
 * AUTH/PAY master keys are supplied by the test:integration env; the crypto
 * primitive reads them from process.env at call time.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { organizations, projects, tenantSecrets } from '../db/schema.js';
import { getTenantSecret, hasTenantSecret, setTenantSecret } from './tenant-secrets.js';

const HAS_DB = Boolean(process.env.BRIVEN_DATA_PLANE_URL);
const S = Date.now().toString(36);
const ORG = `o_tsec_${S}`;
const PROJECT = `p_tsec_${S}`;
const SECRET = 'gho_super-secret-google-client-secret-value';

describe.skipIf(!HAS_DB)('tenant-secrets persistence — OAuth secret drawer (migration 0043)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values({ id: ORG, slug: `tsec-${S}`, name: 'tsec', personal: true, createdBy: null });
    await db
      .insert(projects)
      .values({ id: PROJECT, slug: `tsec-${S}`, name: 'tsec', orgId: ORG });
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(tenantSecrets).where(eq(tenantSecrets.projectId, PROJECT));
    await db.delete(projects).where(eq(projects.id, PROJECT));
    await db.delete(organizations).where(eq(organizations.id, ORG));
  });

  test('set → get round-trips the plaintext', async () => {
    await setTenantSecret(PROJECT, 'auth', 'google_client_secret', SECRET);
    expect(await getTenantSecret(PROJECT, 'auth', 'google_client_secret')).toBe(SECRET);
  });

  test('what is stored in the column is ciphertext, never the plaintext', async () => {
    const db = getDb();
    const [row] = await db
      .select({ enc: tenantSecrets.encryptedValue })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.projectId, PROJECT))
      .limit(1);
    expect(row).toBeTruthy();
    expect(row?.enc).not.toBe(SECRET);
    expect(row?.enc ?? '').not.toContain(SECRET); // plaintext nowhere in the blob
  });

  test('overwrite refreshes the value (UPSERT on project/service/name)', async () => {
    const next = 'gho_rotated-secret-value';
    await setTenantSecret(PROJECT, 'auth', 'google_client_secret', next);
    expect(await getTenantSecret(PROJECT, 'auth', 'google_client_secret')).toBe(next);
  });

  test('hasTenantSecret is presence-only; missing reads return null', async () => {
    expect(await hasTenantSecret(PROJECT, 'auth', 'google_client_secret')).toBe(true);
    expect(await hasTenantSecret(PROJECT, 'auth', 'never_set')).toBe(false);
    expect(await getTenantSecret(PROJECT, 'auth', 'never_set')).toBeNull();
  });

  test("the `service` namespace isolates 'auth' from 'pay'", async () => {
    // same name under a different service is a different secret, no bleed
    expect(await getTenantSecret(PROJECT, 'pay', 'google_client_secret')).toBeNull();
    await setTenantSecret(PROJECT, 'pay', 'google_client_secret', 'pay-side-value');
    expect(await getTenantSecret(PROJECT, 'pay', 'google_client_secret')).toBe('pay-side-value');
    // auth side is unchanged by the pay write
    expect(await getTenantSecret(PROJECT, 'auth', 'google_client_secret')).toBe(
      'gho_rotated-secret-value',
    );
  });
});
