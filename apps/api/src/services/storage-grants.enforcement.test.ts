/**
 * Cross-project storage GRANTS — enforcement unit tests (M5, S3 sprint).
 *
 * This is security code, so the tests pin the strict-deny contract of
 * `isGranted()`: a matching active grant → true; no grant / revoked / wrong
 * grantee → false; exact-id vs prefix matching (and non-match); and strict-deny
 * on any lookup error.
 *
 * We stub the two seams the service touches — `getDb()` (control plane, the
 * grants table) and `getFile()` (resolves a file's object path for prefix
 * matching) — with bun's `mock.module`, exactly like
 * storage-admin.enforcement.test.ts. A tiny fake drizzle builder returns the
 * grant rows the current test set up, and lets us force a DB error to prove the
 * fail-closed path.
 */
import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';

/** Mutable state every stub reads — reset in beforeEach. */
const state = {
  /** Active grant rows a `.select().from(projectStorageGrants)` returns. */
  grantRows: [] as Array<{ resource: string; isPrefix: boolean }>,
  /** Object path getFile() resolves for a file id, keyed by id. */
  filePaths: {} as Record<string, string>,
  /** When true, the grants select throws (proves strict-deny on error). */
  throwOnSelect: false,
  /** When true, getFile throws (file missing/deleted for the granter). */
  throwOnGetFile: false,
};

/** Minimal thenable drizzle-style builder — resolves to the preset grant rows. */
function makeBuilder() {
  const b = {
    select: () => b,
    from: () => b,
    where: () => b,
    limit: () => b,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      if (state.throwOnSelect) {
        const err = new Error('simulated grants lookup failure');
        if (reject) return reject(err);
        throw err;
      }
      return resolve(state.grantRows);
    },
  };
  return b;
}

const execute = mock(async () => undefined);
mock.module('../db/client.js', () => ({
  getDb: () => ({ ...makeBuilder(), execute }),
}));

// getFile resolves a file's object path (used for prefix matching) — scoped to
// the granter. Throwing here mimics a missing/deleted file for that project.
const getFile = mock(async (fileId: string) => {
  if (state.throwOnGetFile) throw new Error('file not found');
  const objectKey = state.filePaths[fileId];
  if (!objectKey) throw new Error('file not found');
  return { objectKey };
});
mock.module('./storage.js', () => ({ getFile }));

let svc: typeof import('./storage-grants.js');
beforeAll(async () => {
  svc = await import('./storage-grants.js');
});

beforeEach(() => {
  state.grantRows = [];
  state.filePaths = {};
  state.throwOnSelect = false;
  state.throwOnGetFile = false;
  getFile.mockClear();
  execute.mockClear();
});

describe('isGranted — strict-deny enforcement', () => {
  const B = 'p_granter';
  const C = 'p_grantee';
  const FILE = 'f_shared';
  const PATH = `projects/${B}/${FILE}`;

  test('active exact grant → true', async () => {
    state.grantRows = [{ resource: FILE, isPrefix: false }];
    state.filePaths[FILE] = PATH;
    expect(await svc.isGranted(C, B, FILE)).toBe(true);
  });

  test('no grant at all → false', async () => {
    state.grantRows = []; // isGranted must not even resolve the file
    state.filePaths[FILE] = PATH;
    expect(await svc.isGranted(C, B, FILE)).toBe(false);
    expect(getFile.mock.calls.length).toBe(0); // short-circuits before file lookup
  });

  test('revoked grant → false (revoked rows are filtered out of grantRows)', async () => {
    // The service filters revoked_at IS NULL in SQL, so a revoked grant simply
    // never appears in grantRows — model that by returning an empty set.
    state.grantRows = [];
    state.filePaths[FILE] = PATH;
    expect(await svc.isGranted(C, B, FILE)).toBe(false);
  });

  test('exact-file match: grant for one file does NOT cover a different file', async () => {
    state.grantRows = [{ resource: FILE, isPrefix: false }];
    state.filePaths['f_other'] = `projects/${B}/f_other`;
    expect(await svc.isGranted(C, B, 'f_other')).toBe(false);
  });

  test('prefix grant covers a file whose path starts with the prefix', async () => {
    state.grantRows = [{ resource: `projects/${B}/shared/`, isPrefix: true }];
    state.filePaths[FILE] = `projects/${B}/shared/${FILE}`;
    expect(await svc.isGranted(C, B, FILE)).toBe(true);
  });

  test('prefix grant does NOT cover a file outside the prefix', async () => {
    state.grantRows = [{ resource: `projects/${B}/shared/`, isPrefix: true }];
    state.filePaths[FILE] = `projects/${B}/private/${FILE}`;
    expect(await svc.isGranted(C, B, FILE)).toBe(false);
  });

  test('a grant to project B does NOT let project C read (grantee is scoped in SQL)', async () => {
    // The grantee filter is in the SQL WHERE, so a grant to a different grantee
    // never lands in grantRows for C — model that with an empty result set.
    state.grantRows = [];
    state.filePaths[FILE] = PATH;
    expect(await svc.isGranted('p_thirdparty', B, FILE)).toBe(false);
  });

  test('strict-deny on a lookup error → false (never throws)', async () => {
    state.throwOnSelect = true;
    state.filePaths[FILE] = PATH;
    await expect(svc.isGranted(C, B, FILE)).resolves.toBe(false);
  });

  test('prefix grant with an unresolvable file (getFile throws) → false', async () => {
    state.grantRows = [{ resource: `projects/${B}/`, isPrefix: true }];
    state.throwOnGetFile = true; // no real path to prefix-match against
    expect(await svc.isGranted(C, B, FILE)).toBe(false);
  });

  test('self-reference (grantee === granter) → false', async () => {
    state.grantRows = [{ resource: FILE, isPrefix: false }];
    state.filePaths[FILE] = PATH;
    expect(await svc.isGranted(B, B, FILE)).toBe(false);
  });

  test('empty / missing args → false', async () => {
    expect(await svc.isGranted('', B, FILE)).toBe(false);
    expect(await svc.isGranted(C, '', FILE)).toBe(false);
    expect(await svc.isGranted(C, B, '')).toBe(false);
  });
});
