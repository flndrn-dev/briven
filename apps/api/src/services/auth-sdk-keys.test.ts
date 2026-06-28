/**
 * Reveal / copy-again unit tests (0039 — encrypted-at-rest SDK keys).
 *
 * Covers the full copy-again contract:
 *   1. creating a key stores a non-empty `encrypted_key` ciphertext;
 *   2. revealing decrypts back to the SAME plaintext shown at creation;
 *   3. a revoked key, and a legacy key with no ciphertext, both refuse reveal;
 *   4. a successful reveal through the route writes a `*.revealed` audit row.
 *
 * Seams stubbed with bun's mock.module: `getDb()` (a tiny in-memory fake that
 * serves both the sdk-keys table and the audit_logs table), the project-auth
 * middleware (pass-through that sets a fake actor), and the heavy route
 * dependencies the reveal path never touches (tenant pool, branding logo, data
 * plane). The real encryption helper (project-env.ts → BRIVEN_ENCRYPTION_KEY)
 * runs unmocked, so the roundtrip exercises actual AES-256-GCM.
 */
import { randomBytes } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Encryption KEK must exist before env.ts is read (frozen at load). Set it
// before any dynamic import below triggers the env/project-env chain.
process.env.BRIVEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');

/** In-memory tables, keyed by the drizzle table object. Reset per test. */
const store = new Map<unknown, Array<Record<string, unknown>>>();
function rowsFor(table: unknown): Array<Record<string, unknown>> {
  let rows = store.get(table);
  if (!rows) {
    rows = [];
    store.set(table, rows);
  }
  return rows;
}

/** Minimal drizzle-style fake: insert/returning, select/where/limit, update/set. */
function makeDb() {
  return {
    insert(table: unknown) {
      const rows = rowsFor(table);
      let inserted: Record<string, unknown> | null = null;
      const b = {
        values(v: Record<string, unknown>) {
          inserted = {
            revokedAt: null,
            lastUsedAt: null,
            expiresAt: null,
            encryptedKey: null,
            createdAt: new Date(),
            ...v,
          };
          rows.push(inserted);
          return b;
        },
        returning() {
          return Promise.resolve(inserted ? [inserted] : []);
        },
        // audit() awaits insert(...).values(...) directly (no .returning()).
        then(resolve: (v: unknown) => unknown) {
          return resolve(undefined);
        },
      };
      return b;
    },
    select(_projection?: unknown) {
      let table: unknown;
      const b = {
        from(t: unknown) {
          table = t;
          return b;
        },
        where() {
          return b;
        },
        orderBy() {
          return b;
        },
        limit() {
          return b;
        },
        then(resolve: (v: unknown) => unknown) {
          return resolve(rowsFor(table).slice());
        },
      };
      return b;
    },
    update(table: unknown) {
      let patch: Record<string, unknown> = {};
      const b = {
        set(v: Record<string, unknown>) {
          patch = v;
          return b;
        },
        where() {
          for (const row of rowsFor(table)) Object.assign(row, patch);
          return Promise.resolve();
        },
      };
      return b;
    },
  };
}

mock.module('../db/client.js', () => ({ getDb: () => makeDb() }));
mock.module('../db/data-plane.js', () => ({
  runInProjectDatabase: async () => undefined,
}));
mock.module('../middleware/project-auth.js', () => ({
  requireProjectAuth:
    () =>
    async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      c.set('user', { id: 'u_test' });
      await next();
    },
  requireProjectRole:
    () =>
    async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      c.set('user', { id: 'u_test' });
      await next();
    },
}));
mock.module('../services/auth-tenant-pool.js', () => ({
  getAuthInstance: async () => ({ betterAuth: { handler: async () => new Response() } }),
  invalidateAuthInstance: async () => undefined,
}));
mock.module('../services/auth-branding-logo.js', () => ({
  brandingLogoPublicUrl: () => '',
  deleteBrandingLogo: async () => undefined,
  getBrandingLogo: async () => null,
  isStorageConfigured: () => false,
  putBrandingLogo: async () => undefined,
  validateLogoUpload: () => undefined,
}));

let svc: typeof import('./auth-sdk-keys.js');
let schema: typeof import('../db/schema.js');
let router: typeof import('../routes/auth-service.js');

beforeAll(async () => {
  svc = await import('./auth-sdk-keys.js');
  schema = await import('../db/schema.js');
  router = await import('../routes/auth-service.js');
});

beforeEach(() => {
  store.clear();
});

const PROJECT = 'p_test01';

describe('createAuthSdkKey — encrypt at rest', () => {
  test('stores a non-empty encrypted_key alongside the hash', async () => {
    const created = await svc.createAuthSdkKey({
      projectId: PROJECT,
      createdBy: 'u_test',
      name: 'prod web',
      scope: 'read',
    });
    expect(created.plaintext.startsWith('pk_briven_auth_')).toBe(true);
    expect(typeof created.record.encryptedKey).toBe('string');
    expect((created.record.encryptedKey as string).length).toBeGreaterThan(0);
    // never the plaintext in the clear
    expect(created.record.encryptedKey).not.toBe(created.plaintext);
  });
});

describe('revealAuthSdkKey — copy again', () => {
  test('decrypts back to the SAME plaintext shown at creation', async () => {
    const created = await svc.createAuthSdkKey({
      projectId: PROJECT,
      createdBy: 'u_test',
      name: 'prod web',
    });
    const revealed = await svc.revealAuthSdkKey(PROJECT, created.record.id);
    expect(revealed.plaintext).toBe(created.plaintext);
  });

  test('revoked key → key_not_revealable', async () => {
    const created = await svc.createAuthSdkKey({
      projectId: PROJECT,
      createdBy: 'u_test',
      name: 'to revoke',
    });
    await svc.revokeAuthSdkKey(PROJECT, created.record.id);
    let code: string | undefined;
    try {
      await svc.revealAuthSdkKey(PROJECT, created.record.id);
    } catch (err) {
      code = (err as { code?: string }).code;
    }
    expect(code).toBe('key_not_revealable');
  });

  test('legacy key with no ciphertext → key_not_revealable', async () => {
    // Simulate a pre-0039 row: present, active, but encrypted_key is null.
    rowsFor(schema.brivenAuthSdkKeys).push({
      id: 'auk_legacy',
      projectId: PROJECT,
      encryptedKey: null,
      revokedAt: null,
    });
    let code: string | undefined;
    try {
      await svc.revealAuthSdkKey(PROJECT, 'auk_legacy');
    } catch (err) {
      code = (err as { code?: string }).code;
    }
    expect(code).toBe('key_not_revealable');
  });

  test('unknown key id → not_found', async () => {
    let code: string | undefined;
    try {
      await svc.revealAuthSdkKey(PROJECT, 'auk_missing');
    } catch (err) {
      code = (err as { code?: string }).code;
    }
    expect(code).toBe('not_found');
  });
});

describe('reveal route — audit + plaintext body', () => {
  test('writes a briven_auth.api_key.revealed audit row and returns plaintext', async () => {
    const created = await svc.createAuthSdkKey({
      projectId: PROJECT,
      createdBy: 'u_test',
      name: 'prod web',
    });

    const res = await router.authServiceRouter.request(
      `/v1/projects/${PROJECT}/auth/api-keys/${created.record.id}/reveal`,
      { method: 'POST' },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plaintext?: string };
    expect(body.plaintext).toBe(created.plaintext);

    const audits = rowsFor(schema.auditLogs);
    const revealRow = audits.find((r) => r.action === 'briven_auth.api_key.revealed');
    expect(revealRow).toBeDefined();
    expect((revealRow?.metadata as { keyId?: string } | undefined)?.keyId).toBe(
      created.record.id,
    );
  });

  test('revoked key over the route → 404 key_not_revealable, no plaintext', async () => {
    const created = await svc.createAuthSdkKey({
      projectId: PROJECT,
      createdBy: 'u_test',
      name: 'to revoke',
    });
    await svc.revokeAuthSdkKey(PROJECT, created.record.id);

    const res = await router.authServiceRouter.request(
      `/v1/projects/${PROJECT}/auth/api-keys/${created.record.id}/reveal`,
      { method: 'POST' },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code?: string; plaintext?: string };
    expect(body.code).toBe('key_not_revealable');
    expect(body.plaintext).toBeUndefined();
  });
});
