/**
 * Full create→write→read→live-update loop — the "smoke alarm" (sprint plan S0.3).
 *
 * Exercises the REAL data-plane helpers (not a re-implementation) against a
 * live DoltGres, proving the exact path ISY hits:
 *
 *   provision a project database
 *     → write a row with `SET dolt_transaction_commit = 1`
 *     → DOLT_HASHOF('HEAD') ADVANCES  (this is what the realtime poller
 *       watches — so a "live update" would actually fire)
 *     → read the row back
 *     → drop the database (cleanup)
 *
 * If any link breaks on DoltGres, it fails HERE instead of in production.
 *
 * How to run (needs the local DoltGres container up on :5433):
 *   BRIVEN_DATA_PLANE_URL=postgres://postgres:password@127.0.0.1:5433/postgres \
 *     bun test src/db/full-loop.integration.test.ts
 *
 * Skips entirely when BRIVEN_DATA_PLANE_URL is unset (keeps the no-DB unit run green).
 */
import { afterAll, describe, expect, test } from 'bun:test';

import {
  closeProjectDbPool,
  dropProjectDatabase,
  provisionProjectDatabase,
  runInProjectDatabase,
} from './data-plane.js';

const HAS_DB = Boolean(process.env.BRIVEN_DATA_PLANE_URL);

// A throwaway project id, unique per run (Date.now is fine in a test file).
const PROJECT_ID = `p_smoke${Date.now().toString(36)}`;

describe.skipIf(!HAS_DB)('full create→write→read→live-update loop', () => {
  afterAll(async () => {
    // Always try to clean up the throwaway database + pools.
    await dropProjectDatabase(PROJECT_ID).catch(() => {});
    await closeProjectDbPool(PROJECT_ID).catch(() => {});
  });

  test('provision → committed write advances HEAD → read back', async () => {
    // 1. Provision the project's own DoltGres database (real helper).
    const dbName = await provisionProjectDatabase(PROJECT_ID);
    expect(dbName).toContain('smoke');

    // 2. Baseline commit hash, read right before the measured write.
    const baseline = await runInProjectDatabase(PROJECT_ID, async (tx) => {
      const rows = await tx.unsafe(`SELECT DOLT_HASHOF('HEAD') AS h`);
      return rows[0]?.h as string | null;
    });

    // 3. Create a table + insert a row in ONE committed Dolt transaction.
    //    `SET dolt_transaction_commit = 1` is what makes COMMIT a real Dolt
    //    commit — exactly how studio.ts / the runtime write.
    await runInProjectDatabase(PROJECT_ID, async (tx) => {
      await tx.unsafe('SET dolt_transaction_commit = 1');
      await tx.unsafe(
        `CREATE TABLE "notes" (id text PRIMARY KEY, title text NOT NULL, body text)`,
      );
      await tx.unsafe(`INSERT INTO "notes" (id, title, body) VALUES ($1,$2,$3)`, [
        'n1',
        'hello ISY',
        'first row',
      ]);
    });

    // 4. HEAD must have ADVANCED — this is the signal the realtime poller
    //    (poll-manager.ts: SELECT DOLT_HASHOF('HEAD')) turns into a live push.
    const after = await runInProjectDatabase(PROJECT_ID, async (tx) => {
      const rows = await tx.unsafe(`SELECT DOLT_HASHOF('HEAD') AS h`);
      return rows[0]?.h as string | null;
    });
    expect(after).toBeTruthy();
    expect(after).not.toBe(baseline);

    // 5. Read the row back through the real per-project path.
    const row = await runInProjectDatabase(PROJECT_ID, async (tx) => {
      const rows = await tx.unsafe(`SELECT id, title, body FROM "notes" WHERE id = $1`, ['n1']);
      return rows[0] as { id: string; title: string; body: string } | undefined;
    });
    expect(row).toEqual({ id: 'n1', title: 'hello ISY', body: 'first row' });
  });
});
