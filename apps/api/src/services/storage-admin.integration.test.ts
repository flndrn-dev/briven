/**
 * Storage admin against REAL DoltGres — sprint plan Sprint 4.
 *
 * Phase 1: getProjectRowCount counts user tables + total rows correctly on
 * DoltGres and excludes _briven_* platform tables. (Bytes stay unmeasurable on
 * DoltGres, so rows + tables are what we report.)
 *
 * Skips when BRIVEN_DATA_PLANE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import pg from 'pg';

import {
  closeProjectDbPool,
  dropProjectDatabase,
  provisionProjectDatabase,
  runInProjectDatabase,
} from '../db/data-plane.js';
import { getProjectRowCount } from './storage-admin.js';

const URL = process.env.BRIVEN_DATA_PLANE_URL;
const HAS_DB = Boolean(URL);
const PROJECT_ID = `p_stor${Date.now().toString(36)}`;

describe.skipIf(!HAS_DB)('storage-admin getProjectRowCount on real DoltGres (Sprint 4)', () => {
  beforeAll(async () => {
    await provisionProjectDatabase(PROJECT_ID);
    await runInProjectDatabase(PROJECT_ID, async (tx) => {
      await tx.unsafe('SET dolt_transaction_commit = 1');
      await tx.unsafe(`CREATE TABLE "widgets" (id integer PRIMARY KEY, label text)`);
      await tx.unsafe(`CREATE TABLE "gadgets" (id integer PRIMARY KEY)`);
      await tx.unsafe(`INSERT INTO "widgets" (id, label) VALUES (1,'a'),(2,'b'),(3,'c')`);
      await tx.unsafe(`INSERT INTO "gadgets" (id) VALUES (10),(20)`);
    });
    // NOTE: provisionProjectDatabase already creates the platform _briven_*
    // tables (_briven_meta, _briven_migrations). Those exercise the exclusion
    // filter for free — getProjectRowCount must NOT count them.
  });

  afterAll(async () => {
    await dropProjectDatabase(PROJECT_ID).catch(() => {});
    await closeProjectDbPool(PROJECT_ID).catch(() => {});
  });

  test('counts user tables + total rows, excluding _briven_*', async () => {
    const { rowCount, tableCount } = await getProjectRowCount(PROJECT_ID);
    expect(tableCount).toBe(2); // widgets + gadgets; _briven_meta excluded
    expect(rowCount).toBe(5); // 3 widgets + 2 gadgets; _briven_meta row excluded
  });

  test('returns zeros (no throw) for an unprovisioned project', async () => {
    const res = await getProjectRowCount('p_does_not_exist_zzz');
    expect(res).toEqual({ rowCount: 0, tableCount: 0 });
  });

  // Migration 0033 runs against the CONTROL-plane DB, which is DoltGres too.
  // Prove its DDL is DoltGres-compatible: the tier_storage_caps table, the
  // idempotent ON CONFLICT seed, and ADD COLUMN bigint (against a stand-in for
  // `projects`, which doesn't exist in the bare data-plane container).
  test('migration 0033 DDL is DoltGres-safe', async () => {
    const c = new pg.Client({ connectionString: URL });
    await c.connect();
    try {
      await c.query(`DROP TABLE IF EXISTS "tier_storage_caps"`);
      await c.query(
        `CREATE TABLE IF NOT EXISTS "tier_storage_caps" ("tier" text PRIMARY KEY NOT NULL, "max_rows" bigint NOT NULL, "max_tables" bigint NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_by" text)`,
      );
      const seed = `INSERT INTO "tier_storage_caps" ("tier","max_rows","max_tables") VALUES ('free',100000,50),('pro',5000000,500),('team',50000000,5000) ON CONFLICT ("tier") DO NOTHING`;
      await c.query(seed);
      await c.query(seed); // idempotent — DoltGres supports ON CONFLICT DO NOTHING
      const r = await c.query(`SELECT tier FROM "tier_storage_caps" ORDER BY tier`);
      expect(r.rows.map((x) => x.tier)).toEqual(['free', 'pro', 'team']);

      await c.query(`DROP TABLE IF EXISTS "_proj_addcol_test"`);
      await c.query(`CREATE TABLE "_proj_addcol_test" (id text PRIMARY KEY)`);
      await c.query(`ALTER TABLE "_proj_addcol_test" ADD COLUMN "storage_max_rows" bigint`);
      await c.query(`ALTER TABLE "_proj_addcol_test" ADD COLUMN "storage_max_tables" bigint`);
    } finally {
      await c.query(`DROP TABLE IF EXISTS "_proj_addcol_test"`).catch(() => {});
      await c.query(`DROP TABLE IF EXISTS "tier_storage_caps"`).catch(() => {});
      await c.end();
    }
  });
});
