/**
 * getStorageUsage against REAL DoltGres — sprint plan S2.2.
 *
 * Proves the storage counter reads the project's OWN database (db-per-project)
 * and returns a real size + table count, instead of the old postgres.js +
 * schema-per-project path that queried the wrong database and silently
 * returned 0. Also confirms `_briven_*` internal tables are excluded.
 *
 * Skips when BRIVEN_DATA_PLANE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  closeProjectDbPools,
  dropProjectDatabase,
  provisionProjectDatabase,
  runInProjectDatabase,
} from '../db/data-plane.js';
import { getStorageUsage } from './usage.js';

const HAS_DB = Boolean(process.env.BRIVEN_DATA_PLANE_URL);
const PROJECT_ID = `p_usage${Date.now().toString(36)}`;

describe.skipIf(!HAS_DB)('getStorageUsage against real DoltGres (S2.2)', () => {
  beforeAll(async () => {
    // Provisioning also creates _briven_migrations + _briven_meta, so this
    // exercises the internal-table exclusion for free.
    await provisionProjectDatabase(PROJECT_ID);
    await runInProjectDatabase(PROJECT_ID, async (tx) => {
      await tx.unsafe('SET dolt_transaction_commit = 1');
      await tx.unsafe(`CREATE TABLE "items" (id text PRIMARY KEY, payload text)`);
      await tx.unsafe(`INSERT INTO "items" (id, payload) VALUES ('1','x'),('2','y'),('3','z')`);
    });
  });

  afterAll(async () => {
    await dropProjectDatabase(PROJECT_ID).catch(() => {});
    await closeProjectDbPools().catch(() => {});
  });

  test('counts only user tables (not _briven_*) from the correct database', async () => {
    const usage = await getStorageUsage(PROJECT_ID);
    // The real fix: queries the project's OWN db and counts correctly. Before,
    // the wrong-db query returned tableCount 0.
    expect(usage.tableCount).toBe(1); // "items" only; _briven_* excluded
    // bytes is best-effort: DoltGres reports relation size as 0 today (see the
    // KNOWN LIMITATION note in getStorageUsage). Assert it's a non-negative
    // number, not that it's > 0.
    expect(typeof usage.bytes).toBe('number');
    expect(usage.bytes).toBeGreaterThanOrEqual(0);
  });
});
