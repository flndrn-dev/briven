import { describe, expect, it } from 'bun:test';

import type { ProjectTx } from './db.js';
import { buildDbClient } from './query-builder.js';

/**
 * F1 — inline DELETE … RETURNING must return the deleted rows, matching the
 * isolate executor (apps/runtime/src/isolate-runtime/loop.ts buildDeleteSql).
 * Both executors agree: no .returning() → []; .returning() → RETURNING * rows;
 * .returning([cols]) → RETURNING those columns.
 */
describe('inline DELETE … RETURNING', () => {
  it('returns the deleted rows', async () => {
    const calls: { sql: string; params: readonly unknown[] }[] = [];
    const deletedRows = [{ id: 1, name: 'gone' }];
    const tx: ProjectTx = {
      unsafe: async (sql, params = []) => {
        calls.push({ sql, params });
        return /RETURNING/.test(sql) ? deletedRows : [];
      },
    };
    const { db } = buildDbClient(tx);

    const rows = await db('widgets').delete().where({ id: 1 }).returning();

    expect(rows).toEqual(deletedRows);
    expect(calls[0]!.sql).toContain('DELETE FROM "widgets"');
    expect(calls[0]!.sql).toContain('RETURNING *');
  });

  it('returns named columns when returning(cols) is given', async () => {
    const calls: string[] = [];
    const tx: ProjectTx = {
      unsafe: async (sql) => {
        calls.push(sql);
        return [{ id: 1 }];
      },
    };
    const { db } = buildDbClient(tx);

    const rows = await db('widgets').delete().where({ id: 1 }).returning(['id']);

    expect(rows).toEqual([{ id: 1 }]);
    expect(calls[0]!).toContain('RETURNING "id"');
  });

  it('returns [] when returning() is not called', async () => {
    const tx: ProjectTx = { unsafe: async () => [{ id: 1 }] };
    const { db } = buildDbClient(tx);

    const rows = await db('widgets').delete().where({ id: 1 });

    expect(rows).toEqual([]);
  });
});
