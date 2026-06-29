/**
 * GDPR hard-purge (migration 0042) — control plane.
 *
 * Guards the Phase-2 fix: `hardDeleteExpiredAccounts` previously ALWAYS threw
 * FK violation 23503 (organizations.created_by + audit_logs.actor_id were
 * ON DELETE NO ACTION), so no expired account was ever erased. Migration 0042
 * flips both FKs to ON DELETE SET NULL + makes created_by nullable, and the
 * purge now hard-deletes the user's own soft-deleted orgs first.
 *
 * This test proves, against real Postgres:
 *   - a soft-deleted user past the 30-day grace IS purged (no 23503);
 *   - a user still within grace is NOT purged;
 *   - the user's own soft-deleted (personal/sole) org is hard-deleted;
 *   - a SHARED org the user created SURVIVES with created_by nulled out
 *     (the original cascade-incident protection);
 *   - an audit row authored by the user survives with actor_id nulled.
 *
 * Integration test (real control Postgres, no mock.module). Gated on
 * BRIVEN_DATA_PLANE_URL — the repo's "integration mode is on" signal — NOT
 * BRIVEN_DATABASE_URL, which test-preload.ts always sets to a dead URL. The
 * test:integration run provides both real URLs together. NOTE: it calls the
 * real purge with graceDays=30, which also removes any OTHER >30-day
 * soft-deleted users present — fine on the throwaway dev/CI control DB.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { auditLogs, organizations, users } from '../db/schema.js';
import { hardDeleteExpiredAccounts } from './account-deletion.js';

const HAS_DB = Boolean(process.env.BRIVEN_DATA_PLANE_URL);
const S = Date.now().toString(36);
const EXPIRED = `u_pexp_${S}`; // soft-deleted 40 days ago → purge
const FRESH = `u_pfresh_${S}`; // soft-deleted 29 days ago → keep
const SHAREOWNER = `u_pshare_${S}`; // expired; created a SURVIVING shared org
const PERSONAL_ORG = `o_ppers_${S}`; // created by EXPIRED, soft-deleted → purge
const SHARED_ORG = `o_pshare_${S}`; // created by SHAREOWNER, NOT soft-deleted → survive
const AUDIT_ROW = `au_p_${S}`;

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const USER_IDS = [EXPIRED, FRESH, SHAREOWNER];
const ORG_IDS = [PERSONAL_ORG, SHARED_ORG];

describe.skipIf(!HAS_DB)('hardDeleteExpiredAccounts — GDPR purge (migration 0042)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db.insert(users).values([
      { id: EXPIRED, email: `${EXPIRED}@x.test`, deletedAt: daysAgo(40) },
      { id: FRESH, email: `${FRESH}@x.test`, deletedAt: daysAgo(29) },
      { id: SHAREOWNER, email: `${SHAREOWNER}@x.test`, deletedAt: daysAgo(40) },
    ]);
    await db.insert(organizations).values([
      // EXPIRED's own soft-deleted personal org → should be hard-deleted.
      {
        id: PERSONAL_ORG,
        slug: `pers-${S}`,
        name: 'personal',
        personal: true,
        createdBy: EXPIRED,
        deletedAt: daysAgo(40),
      },
      // A shared org SHAREOWNER created that is still alive → must survive,
      // created_by nulled (cannot block the purge).
      {
        id: SHARED_ORG,
        slug: `shared-${S}`,
        name: 'shared',
        personal: false,
        createdBy: SHAREOWNER,
      },
    ]);
    await db
      .insert(auditLogs)
      .values({ id: AUDIT_ROW, actorId: SHAREOWNER, action: 'test.purge_fixture' });
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(auditLogs).where(eq(auditLogs.id, AUDIT_ROW));
    await db.delete(organizations).where(inArray(organizations.id, ORG_IDS));
    await db.delete(users).where(inArray(users.id, USER_IDS));
  });

  test('purge erases expired users, keeps in-grace users, and does not throw 23503', async () => {
    const db = getDb();
    await hardDeleteExpiredAccounts({ graceDays: 30 });

    const remaining = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, USER_IDS));
    const ids = remaining.map((r) => r.id);
    expect(ids).toContain(FRESH); // within grace → kept
    expect(ids).not.toContain(EXPIRED); // past grace → erased
    expect(ids).not.toContain(SHAREOWNER); // past grace → erased
  });

  test("the user's own soft-deleted org is hard-deleted", async () => {
    const db = getDb();
    const rows = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, PERSONAL_ORG));
    expect(rows.length).toBe(0);
  });

  test('a SHARED org survives with created_by nulled (no cascade into shared data)', async () => {
    const db = getDb();
    const [org] = await db
      .select({ id: organizations.id, createdBy: organizations.createdBy })
      .from(organizations)
      .where(eq(organizations.id, SHARED_ORG));
    expect(org).toBeTruthy();
    expect(org?.createdBy).toBeNull();
  });

  test('audit row survives with actor_id nulled (trail preserved)', async () => {
    const db = getDb();
    const [row] = await db
      .select({ id: auditLogs.id, actorId: auditLogs.actorId })
      .from(auditLogs)
      .where(eq(auditLogs.id, AUDIT_ROW));
    expect(row).toBeTruthy();
    expect(row?.actorId).toBeNull();
  });
});
