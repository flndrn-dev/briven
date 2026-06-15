/**
 * Contract tests for the admin.flndrn.com dashboard API. Exercises the
 * auth gate + the no-DB endpoints (manifest, ping) against the real Hono
 * router via app.request(). The DB-backed endpoints (summary, users,
 * projects) reuse the services/admin.ts queries and are not stood up here
 * (no postgres in unit tests).
 *
 * env.ts freezes process.env at first import, and that import may already
 * have happened in a sibling test file before this one runs. So rather
 * than fight the load order, we read whatever value env actually froze
 * to and assert the gate's REAL behaviour for that value: a present key
 * proves the 200 + 401 paths, an absent key proves the 503 fail-safe.
 * The two top-level process.env lines mirror the repo convention
 * (cli-jwt.test.ts) for the case where this file is imported first.
 */

const ORIGINAL_KEY = process.env.BRIVEN_ADMIN_API_KEY;
process.env.BRIVEN_ADMIN_API_KEY = ORIGINAL_KEY ?? 'test-admin-key-0123456789abcdef';

import { afterAll, describe, expect, test } from 'bun:test';

const { Hono } = await import('hono');
const { env } = await import('../env.js');
const { adminManifestRouter } = await import('./admin-manifest.js');

const app = new Hono();
app.route('/', adminManifestRouter);

// The effective key the gate compares against (frozen at env import).
const KEY = env.BRIVEN_ADMIN_API_KEY;
const auth = KEY ? { headers: { authorization: `Bearer ${KEY}` } } : undefined;

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.BRIVEN_ADMIN_API_KEY;
  else process.env.BRIVEN_ADMIN_API_KEY = ORIGINAL_KEY;
});

describe('admin-manifest auth gate', () => {
  test('manifest with no/blank bearer → 401 when configured, 503 when not', async () => {
    const res = await app.request('/api/admin/v1/manifest');
    expect(res.status).toBe(KEY ? 401 : 503);
  });

  test('wrong bearer → 401 when configured, 503 when not', async () => {
    const res = await app.request('/api/admin/v1/manifest', {
      headers: { authorization: 'Bearer definitely-wrong-key' },
    });
    expect(res.status).toBe(KEY ? 401 : 503);
  });

  test('summary runs no DB query before the auth gate', async () => {
    // Unauthenticated → must short-circuit at the gate (401/503), never
    // reach getDb(). A thrown DB error would surface as 500.
    const res = await app.request('/api/admin/v1/summary');
    expect(res.status).toBe(KEY ? 401 : 503);
  });
});

describe('admin-manifest manifest shape', () => {
  test('authenticated manifest → 200 with valid sections', async () => {
    if (!auth) {
      // Unconfigured deploy: gate returns 503, which the consumer renders
      // as "not configured". Manifest shape is asserted in the configured
      // path below when a key is present.
      const res = await app.request('/api/admin/v1/manifest');
      expect(res.status).toBe(503);
      return;
    }
    const res = await app.request('/api/admin/v1/manifest', auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sections: Array<{
        key: string;
        title: string;
        icon: string;
        permission: string;
        endpoints: Array<{ kind: string; method: string; path: string }>;
      }>;
    };
    expect(Array.isArray(body.sections)).toBe(true);
    expect(body.sections.length).toBeGreaterThan(0);
    for (const s of body.sections) {
      expect(typeof s.key).toBe('string');
      expect(typeof s.title).toBe('string');
      expect(typeof s.icon).toBe('string');
      expect(s.permission).toBe('dev.briven.read');
      expect(s.endpoints.length).toBeGreaterThan(0);
      for (const e of s.endpoints) {
        expect(['list', 'detail', 'actions']).toContain(e.kind);
        expect(e.method).toBe('GET');
        expect(e.path.startsWith('/api/admin/v1/')).toBe(true);
      }
    }
  });

  test('bare /api/admin/manifest alias resolves to same handler', async () => {
    const res = await app.request('/api/admin/manifest', auth);
    expect(res.status).toBe(KEY ? 200 : 503);
  });
});

describe('admin-manifest ping', () => {
  test('authenticated ping → 200 { ok, service: briven, ts }', async () => {
    if (!auth) {
      const res = await app.request('/api/admin/v1/ping');
      expect(res.status).toBe(503);
      return;
    }
    const res = await app.request('/api/admin/v1/ping', auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string; ts: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('briven');
    expect(typeof body.ts).toBe('string');
  });

  test('bare /api/admin/ping alias resolves to same handler', async () => {
    const res = await app.request('/api/admin/ping', auth);
    expect(res.status).toBe(KEY ? 200 : 503);
  });
});
