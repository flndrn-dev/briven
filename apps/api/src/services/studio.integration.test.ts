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
import {
  createTable,
  executeQuery,
  getTableColumns,
  insertRow,
  listIndexes,
  truncateTable,
} from './studio.js';

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

  // S3 ISY-live regression: the full customer data path through the studio
  // service functions. getTableColumns used a pg_index/pg_attribute PK-detection
  // join (`attnum = ANY(indkey)`) that DoltGres 500s on
  // ("operator does not exist: smallint = int2vector"), which broke EVERY row
  // insert + read on a real DoltGres table even though createTable worked.
  // Caught only by the live ISY proof; this locks the whole path.
  test('S3 ISY path: createTable → getTableColumns (PK) → insertRow → read', async () => {
    const t = 'isy_proof';
    await createTable({
      projectId: PROJECT_ID,
      tableName: t,
      columns: [
        { name: 'id', type: 'integer', primaryKey: true, notNull: true },
        { name: 'label', type: 'text' },
      ],
    });
    // Must NOT throw the int2vector error, and must detect the primary key.
    const cols = await getTableColumns(PROJECT_ID, t);
    expect(cols.find((c) => c.name === 'id')?.isPrimaryKey).toBe(true);
    expect(cols.find((c) => c.name === 'label')?.isPrimaryKey).toBe(false);
    // insertRow calls getTableColumns internally, then INSERT ... RETURNING *.
    const ins = await insertRow({
      projectId: PROJECT_ID,
      tableName: t,
      values: { id: 1, label: 'Hello ISY' },
    });
    expect((ins.inserted as { id?: number } | null)?.id).toBe(1);
    // Read it back.
    const res = await executeQuery(PROJECT_ID, `SELECT id, label FROM "${t}" ORDER BY id`);
    expect(res.rows.length).toBe(1);
    expect((res.rows[0] as { label: string }).label).toBe('Hello ISY');
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
