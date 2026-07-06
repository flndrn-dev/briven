/**
 * Tokenized public share-links — enforcement unit tests (M5, S3 sprint).
 *
 * This is security code (a link = public bearer access to one file), so the
 * tests pin the strict-deny contract:
 *   - create → resolve returns the exact file;
 *   - an expired link → null;
 *   - a revoked link → null;
 *   - an unknown / garbage token → null;
 *   - a link resolves ONLY its own file (not another link's);
 *   - revoke is owner-scoped (project A cannot revoke project B's link);
 *   - the expiry clamp is applied (min / default / max).
 *
 * We stub the two seams the service touches — `getDb()` (the share-links control
 * table) and `getFile()` (owner-scoped file existence) — with bun's
 * `mock.module`, exactly like storage-grants.enforcement.test.ts. A tiny fake
 * drizzle builder holds an in-memory rows array; insert/update/select operate on
 * it so we can drive create → resolve → revoke end-to-end, and force a DB error
 * to prove the fail-closed path.
 */
import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';

interface LinkRow {
  id: string;
  projectId: string;
  fileId: string;
  token: string;
  expiresAt: Date;
  createdBy: string | null;
  createdAt: Date;
  revokedAt: Date | null;
}

/** Mutable state every stub reads — reset in beforeEach. */
const state = {
  /** The in-memory share-links table. */
  rows: [] as LinkRow[],
  /** Files getFile() will resolve, keyed by `${projectId}::${fileId}`. */
  files: new Set<string>(),
  /** When true, any select throws (proves strict-deny → null on error). */
  throwOnSelect: false,
};

/**
 * Minimal drizzle-style builder over `state.rows`. It captures the column
 * predicates drizzle passes (as opaque objects we can't read), so instead we
 * model the two shapes the service actually issues:
 *   - resolveShareLink: select().from().where(token & !revoked & expires>now).limit(1)
 *   - listShareLinks:  select().from().where(projectId)
 *   - revokeShareLink: update().set().where(id & projectId).returning()
 *   - createShareLink: insert().values().returning()
 * We can't introspect the drizzle condition objects, so the builder records the
 * raw values the service embeds via a side channel: the service calls eq()/gt()
 * with real values, but those are drizzle internals here. To keep the fake
 * honest we instead re-implement the predicates the service documents, reading
 * the values the test set up. See each method.
 */

// Because drizzle's eq()/gt()/and() return opaque SQL objects, the fake can't
// read them. We therefore expose the predicate VALUES the service uses by
// wrapping drizzle: our mock of './storage.js' + './db/schema.js' is not enough.
// Simplest faithful approach: mock drizzle-orm's helpers to return tagged
// objects the builder CAN read.
const eqTag = (col: unknown, val: unknown) => ({ op: 'eq', col, val });
const gtTag = (col: unknown, val: unknown) => ({ op: 'gt', col, val });
const isNullTag = (col: unknown) => ({ op: 'isNull', col });
const andTag = (...parts: unknown[]) => ({ op: 'and', parts });

// Column identity markers — the schema mock returns these; predicates carry them.
const COL = {
  id: 'col:id',
  projectId: 'col:projectId',
  fileId: 'col:fileId',
  token: 'col:token',
  expiresAt: 'col:expiresAt',
  revokedAt: 'col:revokedAt',
};

mock.module('drizzle-orm', () => ({
  eq: eqTag,
  gt: gtTag,
  isNull: isNullTag,
  and: andTag,
  sql: { raw: (s: string) => s },
}));

mock.module('../db/schema.js', () => ({
  projectStorageShareLinks: COL,
}));

/** Flatten an and()/leaf predicate tree into a list of leaf tags. */
function leaves(pred: any): any[] {
  if (!pred) return [];
  if (pred.op === 'and') return pred.parts.flatMap(leaves);
  return [pred];
}

/** Does a row satisfy the flattened predicate leaves? */
function matches(row: LinkRow, pred: any): boolean {
  for (const l of leaves(pred)) {
    if (l.op === 'eq') {
      if (l.col === COL.id && row.id !== l.val) return false;
      if (l.col === COL.projectId && row.projectId !== l.val) return false;
      if (l.col === COL.token && row.token !== l.val) return false;
    } else if (l.op === 'isNull') {
      if (l.col === COL.revokedAt && row.revokedAt !== null) return false;
    } else if (l.op === 'gt') {
      if (l.col === COL.expiresAt && !(row.expiresAt.getTime() > (l.val as Date).getTime()))
        return false;
    }
  }
  return true;
}

function makeDb() {
  return {
    execute: mock(async () => undefined),
    insert() {
      return {
        values(v: LinkRow) {
          return {
            returning: async () => {
              const row: LinkRow = {
                ...v,
                createdBy: v.createdBy ?? null,
                createdAt: new Date(),
                revokedAt: null,
              };
              state.rows.push(row);
              return [row];
            },
          };
        },
      };
    },
    update() {
      return {
        set(patch: Partial<LinkRow>) {
          return {
            where(pred: any) {
              return {
                returning: async () => {
                  const hit = state.rows.filter((r) => matches(r, pred));
                  for (const r of hit) Object.assign(r, patch);
                  return hit;
                },
              };
            },
          };
        },
      };
    },
    select() {
      return {
        from: () => ({
          where: (pred: any) => {
            const run = () => {
              if (state.throwOnSelect) throw new Error('simulated select failure');
              return state.rows.filter((r) => matches(r, pred));
            };
            const chain = {
              limit: async () => run(),
              then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
                try {
                  return res(run());
                } catch (e) {
                  if (rej) return rej(e);
                  throw e;
                }
              },
            };
            return chain;
          },
        }),
      };
    },
  };
}

let db = makeDb();
mock.module('../db/client.js', () => ({ getDb: () => db }));

// getFile: owner-scoped existence. Throws if the project doesn't own the file.
const getFile = mock(async (fileId: string, projectId: string) => {
  if (!state.files.has(`${projectId}::${fileId}`)) throw new Error('file not found');
  return { id: fileId, objectKey: `projects/${projectId}/${fileId}` };
});
mock.module('./storage.js', () => ({ getFile }));

let svc: typeof import('./storage-share-links.js');
beforeAll(async () => {
  svc = await import('./storage-share-links.js');
});

beforeEach(() => {
  state.rows = [];
  state.files = new Set();
  state.throwOnSelect = false;
  db = makeDb();
  getFile.mockClear();
});

const P = 'p_owner';
const OTHER = 'p_other';
const FILE = 'f_shared';

describe('createShareLink', () => {
  test('rejects a file the project does not own (getFile throws)', async () => {
    // no file seeded → getFile throws → create rejects
    await expect(
      svc.createShareLink({ projectId: P, fileId: FILE, createdBy: null }),
    ).rejects.toThrow();
    expect(state.rows.length).toBe(0);
  });

  test('mints a link with a URL-safe token and a media /link/ url', async () => {
    state.files.add(`${P}::${FILE}`);
    const link = await svc.createShareLink({ projectId: P, fileId: FILE, createdBy: 'mck_1' });
    expect(link.id).toStartWith('sl_');
    expect(link.token.length).toBeGreaterThanOrEqual(32);
    expect(link.token).toMatch(/^[A-Za-z0-9\-_]+$/); // base64url alphabet only
    expect(link.url).toBe(`https://media.briven.tech/link/${link.token}`);
    expect(state.rows.length).toBe(1);
  });
});

describe('resolveShareLink — strict-deny enforcement', () => {
  test('create → resolve returns the exact file', async () => {
    state.files.add(`${P}::${FILE}`);
    const link = await svc.createShareLink({ projectId: P, fileId: FILE, createdBy: null });
    expect(await svc.resolveShareLink(link.token)).toEqual({ projectId: P, fileId: FILE });
  });

  test('unknown / garbage token → null', async () => {
    expect(await svc.resolveShareLink('not-a-real-token')).toBeNull();
    expect(await svc.resolveShareLink('')).toBeNull();
    // @ts-expect-error — hostile non-string input must still fail closed
    expect(await svc.resolveShareLink(null)).toBeNull();
  });

  test('expired link → null', async () => {
    state.files.add(`${P}::${FILE}`);
    const link = await svc.createShareLink({
      projectId: P,
      fileId: FILE,
      expiresInSeconds: 60,
      createdBy: null,
    });
    // Force the stored row into the past.
    const stored = state.rows[0];
    expect(stored).toBeDefined();
    stored!.expiresAt = new Date(Date.now() - 1000);
    expect(await svc.resolveShareLink(link.token)).toBeNull();
  });

  test('revoked link → null', async () => {
    state.files.add(`${P}::${FILE}`);
    const link = await svc.createShareLink({ projectId: P, fileId: FILE, createdBy: null });
    await svc.revokeShareLink(P, link.id);
    expect(await svc.resolveShareLink(link.token)).toBeNull();
  });

  test('a link resolves ONLY its own file, not another link\'s', async () => {
    state.files.add(`${P}::${FILE}`);
    state.files.add(`${P}::f_second`);
    const a = await svc.createShareLink({ projectId: P, fileId: FILE, createdBy: null });
    const b = await svc.createShareLink({ projectId: P, fileId: 'f_second', createdBy: null });
    expect(await svc.resolveShareLink(a.token)).toEqual({ projectId: P, fileId: FILE });
    expect(await svc.resolveShareLink(b.token)).toEqual({ projectId: P, fileId: 'f_second' });
    // Cross-token never leaks the other file.
    const reA = await svc.resolveShareLink(a.token);
    expect(reA?.fileId).not.toBe('f_second');
  });

  test('strict-deny on a lookup error → null (never throws)', async () => {
    state.files.add(`${P}::${FILE}`);
    const link = await svc.createShareLink({ projectId: P, fileId: FILE, createdBy: null });
    state.throwOnSelect = true;
    await expect(svc.resolveShareLink(link.token)).resolves.toBeNull();
  });
});

describe('revokeShareLink — owner-scoped', () => {
  test('project A cannot revoke project B\'s link', async () => {
    state.files.add(`${P}::${FILE}`);
    const link = await svc.createShareLink({ projectId: P, fileId: FILE, createdBy: null });
    // OTHER tries to revoke P's link → NotFoundError, and the link still resolves.
    await expect(svc.revokeShareLink(OTHER, link.id)).rejects.toThrow();
    expect(await svc.resolveShareLink(link.token)).toEqual({ projectId: P, fileId: FILE });
    // The real owner CAN revoke.
    await svc.revokeShareLink(P, link.id);
    expect(await svc.resolveShareLink(link.token)).toBeNull();
  });
});

describe('clampExpiresInSeconds — expiry clamp applied', () => {
  test('below min clamps up to 60s', () => {
    expect(svc.clampExpiresInSeconds(1)).toBe(60);
    expect(svc.clampExpiresInSeconds(0)).toBe(60);
    expect(svc.clampExpiresInSeconds(-100)).toBe(60);
  });
  test('unset / non-finite defaults to 24h', () => {
    expect(svc.clampExpiresInSeconds(null)).toBe(86400);
    expect(svc.clampExpiresInSeconds(undefined)).toBe(86400);
    expect(svc.clampExpiresInSeconds(Number.NaN)).toBe(86400);
  });
  test('above max clamps down to 30 days', () => {
    expect(svc.clampExpiresInSeconds(999_999_999)).toBe(30 * 24 * 60 * 60);
  });
  test('a sane value passes through (floored)', () => {
    expect(svc.clampExpiresInSeconds(3600)).toBe(3600);
    expect(svc.clampExpiresInSeconds(3600.9)).toBe(3600);
  });

  test('create applies the clamp to the stored expiry', async () => {
    state.files.add(`${P}::${FILE}`);
    const before = Date.now();
    const link = await svc.createShareLink({
      projectId: P,
      fileId: FILE,
      expiresInSeconds: 5, // below min → clamps to 60s
      createdBy: null,
    });
    const expMs = new Date(link.expiresAt).getTime();
    // ~60s out, not ~5s out.
    expect(expMs - before).toBeGreaterThanOrEqual(55_000);
    expect(expMs - before).toBeLessThanOrEqual(65_000);
  });
});
