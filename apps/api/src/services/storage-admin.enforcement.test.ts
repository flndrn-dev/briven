/**
 * Enforcement-mode unit tests (Sprint 4 Phase 4 — the "block" lever).
 *
 * The existing storage-admin.test.ts only exercises the pure flag math; the
 * stateful enforcement logic (cache, block decision, fail-open) needs the
 * control DB and the project-DB row count, so we stub the two seams those
 * touch — `getDb()` (control plane) and `runInProjectDatabase()` (project
 * plane) — with bun's mock.module. A tiny fake drizzle builder returns
 * preset rows keyed by which table the chain selected `.from()`, so the same
 * stub serves getProjectEnforcement, getTierStorageCaps and the projects
 * lookup inside assertWithinStorageLimit. `_resetEnforcementCache()` runs
 * between tests so the in-memory cache never leaks across cases.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ValidationError } from '@briven/shared';

import { projects, tierStorageCaps } from '../db/schema.js';

/** Mutable state every stub reads — reset in beforeEach. */
const state = {
  /** Row returned for a `.from(projects)` lookup (null = no such project). */
  projectRow: null as Record<string, unknown> | null,
  /** Rows returned for a `.from(tierStorageCaps)` lookup. */
  tierCaps: [] as Array<Record<string, unknown>>,
  /** Counts the fake project DB reports back through getProjectRowCount. */
  rowCount: 0,
  tableCount: 0,
  /** How many control-plane projects reads ran (proves cache hits/misses). */
  projectSelects: 0,
};

/** Minimal thenable drizzle-style builder; resolves by the `.from()` table. */
function makeBuilder() {
  let table: unknown;
  const b = {
    select: () => b,
    update: () => b,
    set: () => b,
    from: (t: unknown) => {
      table = t;
      return b;
    },
    where: () => b,
    limit: () => b,
    then: (resolve: (v: unknown) => unknown) => {
      if (table === tierStorageCaps) return resolve(state.tierCaps);
      if (table === projects) {
        state.projectSelects += 1;
        return resolve(state.projectRow ? [state.projectRow] : []);
      }
      return resolve([]);
    },
  };
  return b;
}

// runInProjectDatabase is what getProjectRowCount calls; the mock ignores the
// callback and hands back the preset counts. Tracking its calls lets us prove
// flag-mode / fail-open paths NEVER touch the project DB.
const runInProjectDatabase = mock(async () => ({
  rowCount: state.rowCount,
  tableCount: state.tableCount,
}));

mock.module('../db/client.js', () => ({ getDb: () => makeBuilder() }));
mock.module('../db/data-plane.js', () => ({ runInProjectDatabase }));

let svc: typeof import('./storage-admin.js');
beforeAll(async () => {
  svc = await import('./storage-admin.js');
});

beforeEach(() => {
  state.projectRow = null;
  state.tierCaps = [];
  state.rowCount = 0;
  state.tableCount = 0;
  state.projectSelects = 0;
  runInProjectDatabase.mockClear();
  svc._resetEnforcementCache();
});

afterEach(() => {
  svc._resetEnforcementCache();
});

describe('getProjectEnforcement', () => {
  test("defaults to 'flag' for an unknown/absent project", async () => {
    state.projectRow = null; // no such project
    expect(await svc.getProjectEnforcement('p_unknown')).toBe('flag');
  });

  test('caches — a second call does not re-query the control DB', async () => {
    state.projectRow = { mode: 'block' };
    expect(await svc.getProjectEnforcement('p_cache')).toBe('block');
    expect(state.projectSelects).toBe(1); // first call hit the DB

    // If the cache were ignored this second call would re-query (and could
    // return a changed value); instead it must short-circuit on the cache.
    state.projectRow = { mode: 'flag' };
    expect(await svc.getProjectEnforcement('p_cache')).toBe('block');
    expect(state.projectSelects).toBe(1); // still 1 → served from cache
  });
});

describe('setProjectEnforcement', () => {
  test('rejects an invalid mode with a ValidationError', async () => {
    await expect(
      // @ts-expect-error — deliberately passing an invalid mode
      svc.setProjectEnforcement('p1', 'nope', null),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('a valid change invalidates the cache (next read re-queries)', async () => {
    state.projectRow = { mode: 'block' };
    expect(await svc.getProjectEnforcement('p1')).toBe('block'); // cached 'block'

    state.projectRow = { mode: 'flag' };
    await svc.setProjectEnforcement('p1', 'flag', null); // must drop the cache entry

    state.projectSelects = 0;
    expect(await svc.getProjectEnforcement('p1')).toBe('flag'); // re-queried
    expect(state.projectSelects).toBe(1); // a fresh read ran → cache was invalidated
  });
});

describe('assertWithinStorageLimit', () => {
  test("'flag' mode is a no-op — never throws, never counts rows", async () => {
    state.projectRow = { mode: 'flag', tier: 'free', storageMaxRows: null, storageMaxTables: null };
    await expect(svc.assertWithinStorageLimit('p1', 'row')).resolves.toBeUndefined();
    expect(runInProjectDatabase.mock.calls.length).toBe(0); // getProjectRowCount not called
  });

  test("'block' mode throws a ValidationError when a row write exceeds the cap", async () => {
    state.projectRow = { mode: 'block', tier: 'free', storageMaxRows: null, storageMaxTables: null };
    state.tierCaps = [{ tier: 'free', maxRows: 100, maxTables: 50 }];
    state.rowCount = 100; // 100 + 1 > 100 → over
    state.tableCount = 1;
    await expect(svc.assertWithinStorageLimit('p1', 'row')).rejects.toBeInstanceOf(ValidationError);
  });

  test("'block' mode throws when a table write exceeds the table cap", async () => {
    state.projectRow = { mode: 'block', tier: 'free', storageMaxRows: null, storageMaxTables: null };
    state.tierCaps = [{ tier: 'free', maxRows: 100, maxTables: 50 }];
    state.rowCount = 1;
    state.tableCount = 50; // 50 + 1 > 50 → over
    await expect(svc.assertWithinStorageLimit('p1', 'table')).rejects.toBeInstanceOf(ValidationError);
  });

  test("'block' mode does NOT throw when the write stays under the cap", async () => {
    state.projectRow = { mode: 'block', tier: 'free', storageMaxRows: null, storageMaxTables: null };
    state.tierCaps = [{ tier: 'free', maxRows: 100, maxTables: 50 }];
    state.rowCount = 10; // 10 + 1 ≤ 100
    state.tableCount = 2; // 2 + 1 ≤ 50
    await expect(svc.assertWithinStorageLimit('p1', 'row')).resolves.toBeUndefined();
    await expect(svc.assertWithinStorageLimit('p1', 'table')).resolves.toBeUndefined();
  });

  test('fails OPEN (no throw) for an unknown project even in block mode', async () => {
    // Prime the cache to 'block' for this id…
    state.projectRow = { mode: 'block' };
    expect(await svc.getProjectEnforcement('p_ghost')).toBe('block');

    // …then make the projects lookup inside assert come back empty.
    state.projectRow = null;
    runInProjectDatabase.mockClear();
    await expect(svc.assertWithinStorageLimit('p_ghost', 'row')).resolves.toBeUndefined();
    expect(runInProjectDatabase.mock.calls.length).toBe(0); // bailed before counting
  });
});
