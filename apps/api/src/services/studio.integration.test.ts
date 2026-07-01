/**
 * Studio data-plane fixes against REAL DoltGres — sprint plan S1.1–S1.4.
 *
 * Guards the Batch-A studio fixes by calling the actual studio functions
 * against a live DoltGres project database:
 *   - S1.2  executeQuery runs without the removed SET LOCAL statements
 *   - S1.3  truncateTable wipes rows (no RESTART IDENTITY) and rejects CASCADE
 *   - S1.4  listIndexes works via information_schema.statistics (the
 *           pg_index/array_position join DoltGres rejected is gone)
 * (S1.1's lower()+LIKE substring match is locked by the compat alarm.)
 *
 * Skips when BRIVEN_DATA_PLANE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { ValidationError } from '@briven/shared';

import {
  closeProjectDbPools,
  dropProjectDatabase,
  provisionProjectDatabase,
  runInProjectDatabase,
} from '../db/data-plane.js';
import { executeQuery, listIndexes, truncateTable } from './studio.js';

const HAS_DB = Boolean(process.env.BRIVEN_DATA_PLANE_URL);
const PROJECT_ID = `p_studio${Date.now().toString(36)}`;
const TABLE = 'widgets';

describe.skipIf(!HAS_DB)('studio against real DoltGres (S1.1–S1.4)', () => {
  beforeAll(async () => {
    await provisionProjectDatabase(PROJECT_ID);
    await runInProjectDatabase(PROJECT_ID, async (tx) => {
      await tx.unsafe('SET dolt_transaction_commit = 1');
      await tx.unsafe(`CREATE TABLE "${TABLE}" (id text PRIMARY KEY, email text, name text)`);
      await tx.unsafe(`CREATE INDEX "${TABLE}_email_idx" ON "${TABLE}" (email)`);
      await tx.unsafe(`CREATE UNIQUE INDEX "${TABLE}_name_ux" ON "${TABLE}" (name)`);
      await tx.unsafe(
        `INSERT INTO "${TABLE}" (id, email, name) VALUES ('1','A@x.com','Alice'),('2','b@x.com','Bob')`,
      );
    });
  });

  afterAll(async () => {
    await dropProjectDatabase(PROJECT_ID).catch(() => {});
    await closeProjectDbPools().catch(() => {});
  });

  test('S1.4 listIndexes returns primary + secondary + unique with columns', async () => {
    const idx = await listIndexes(PROJECT_ID, TABLE);
    expect(idx.find((i) => i.isPrimary)).toBeTruthy();
    const email = idx.find((i) => i.columns.includes('email') && !i.isPrimary);
    expect(email).toBeTruthy();
    expect(email?.unique).toBe(false);
    const name = idx.find((i) => i.columns.includes('name') && !i.isPrimary);
    expect(name).toBeTruthy();
    expect(name?.unique).toBe(true);
  });

  test('S1.2 executeQuery runs without SET LOCAL', async () => {
    const res = await executeQuery(PROJECT_ID, `SELECT id FROM "${TABLE}" ORDER BY id`);
    expect(res.rows.length).toBe(2);
  });

  test('S1.3 truncateTable wipes rows; cascade is rejected', async () => {
    await truncateTable(PROJECT_ID, TABLE);
    const res = await executeQuery(PROJECT_ID, `SELECT count(*)::int AS n FROM "${TABLE}"`);
    expect(Number((res.rows[0] as { n: number }).n)).toBe(0);
    await expect(truncateTable(PROJECT_ID, TABLE, true)).rejects.toThrow(ValidationError);
  });
});
