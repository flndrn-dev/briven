// Route-level tests for the customer per-project database lifecycle
// routes (/v1/projects/:id/db/health|snapshots|restart|recover|reprovision).
//
// Env vars must be set BEFORE any module that reads them is imported, so
// real modules are pulled in via top-level `await import` after the
// process.env mutation — mirroring routes/projects.test.ts.
//
// IMPORTANT: bun's mock.module() is process-GLOBAL and is NOT reverted
// between test files (see services/auth-sdk-keys.test.ts). Every stub here
// therefore (a) spreads the REAL module so no export goes missing, and
// (b) DELEGATES to the real implementation unless an explicit x-test-*
// header / test-only project id is present — so later test files that hit
// these modules see unchanged behavior.

const ORIGINAL_SECRET = process.env.BRIVEN_BETTER_AUTH_SECRET;
const ORIGINAL_DB_URL = process.env.BRIVEN_DATABASE_URL;
process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET ?? 'a'.repeat(32);
process.env.BRIVEN_DATABASE_URL = ORIGINAL_DB_URL ?? 'postgres://test:test@127.0.0.1:5/test';

import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { Hono } from 'hono';

import type { ProjectAppEnv } from '../types/app-env.js';

// Module namespace objects are LIVE — after mock.module() the properties
// on these namespaces point at the mocks. Snapshot the original exports
// (spread) and the original functions NOW, before any mock is installed,
// so the delegating stubs below call the real implementations and don't
// recurse into themselves.
const realProjectAuth = { ...(await import('../middleware/project-auth.js')) };
const realStepUp = { ...(await import('../middleware/step-up.js')) };
const realProjects = { ...(await import('../services/projects.js')) };

// Test-authenticated requests carry `x-test-role`; everything else falls
// through to the REAL requireProjectAuth (session/brk_/cli-jwt branches).
// MUST forward `paramName` — platform routes use requireProjectAuth('ref');
// defaulting to 'id' reintroduces the "missing project id" 403 on /platform/*.
mock.module('../middleware/project-auth.js', () => ({
  ...realProjectAuth,
  requireProjectAuth:
    (paramName: string = 'id') =>
    async (
      c: {
        req: { header: (name: string) => string | undefined };
        set: (key: string, value: unknown) => void;
      },
      next: () => Promise<void>,
    ) => {
      const role = c.req.header('x-test-role');
      if (!role) {
        return realProjectAuth.requireProjectAuth(paramName)(c as never, next);
      }
      c.set('user', { id: 'u_dbtest', email: 'dbtest@example.com', name: 'db test' });
      c.set('apiKeyId', null);
      c.set('projectRole', role);
      await next();
    },
}));

// `x-test-mfa: fresh` passes, `x-test-mfa: stale` returns the real gate's
// 403 shape; no header → REAL requireRecentMfa (db-backed) for later files.
mock.module('../middleware/step-up.js', () => ({
  ...realStepUp,
  requireRecentMfa: (maxAgeMin = 10) => {
    const real = realStepUp.requireRecentMfa(maxAgeMin);
    return async (
      c: {
        req: { header: (name: string) => string | undefined };
        json: (body: unknown, status?: number) => Response;
      },
      next: () => Promise<void>,
    ) => {
      const attest = c.req.header('x-test-mfa');
      if (attest === 'fresh') {
        await next();
        return;
      }
      if (attest === 'stale') {
        return c.json({ code: 'step_up_required', maxAgeMin }, 403);
      }
      return real(c as never, next);
    };
  },
}));

// Known project row for the reprovision confirm-name check; every other
// project id resolves through the real service.
mock.module('../services/projects.js', () => ({
  ...realProjects,
  getProjectInfo: async (projectId: string) => {
    if (projectId !== 'p_dbtest') return realProjects.getProjectInfo(projectId);
    return { id: projectId, name: 'jungle raid', slug: 'jungle-raid' } as Awaited<
      ReturnType<typeof realProjects.getProjectInfo>
    >;
  },
}));

let app: Hono<ProjectAppEnv>;

beforeAll(async () => {
  const { dbRouter } = await import('./db.js');
  const { errorHandler } = await import('../middleware/error.js');
  app = new Hono<ProjectAppEnv>();
  app.onError(errorHandler);
  app.route('/', dbRouter);
});

async function call(
  method: 'GET' | 'POST',
  path: string,
  opts: { role?: string; mfa?: 'fresh' | 'stale'; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'x-forwarded-for': '203.0.113.9' };
  if (opts.role) headers['x-test-role'] = opts.role;
  if (opts.mfa) headers['x-test-mfa'] = opts.mfa;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return await app.request(path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

const BASE = '/v1/projects/p_dbtest/db';

describe('customer database lifecycle routes — gating', () => {
  it('rejects unauthenticated callers with 401', async () => {
    const res = await call('GET', `${BASE}/health`);
    expect(res.status).toBe(401);
  });

  it('rejects sub-admin roles with 403 (router-level admin gate)', async () => {
    const res = await call('GET', `${BASE}/health`, { role: 'developer' });
    expect(res.status).toBe(403);
  });

  it('gates mutations behind recent step-up auth (403 step_up_required)', async () => {
    const res = await call('POST', `${BASE}/restart`, { role: 'admin', mfa: 'stale', body: {} });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('step_up_required');
  });

  it('reprovision refuses role admin — owner only', async () => {
    const res = await call('POST', `${BASE}/reprovision`, {
      role: 'admin',
      mfa: 'fresh',
      body: { confirmName: 'jungle raid' },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message?: string };
    expect(body.message ?? '').toContain('owner');
  });
});

describe('customer database lifecycle routes — typed confirmations', () => {
  it('recover without the confirm field → 400 validation_failed', async () => {
    const res = await call('POST', `${BASE}/recover`, {
      role: 'admin',
      mfa: 'fresh',
      body: { snapshotId: 's000000000000000000000001' },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('validation_failed');
  });

  it('recover with the wrong confirm word → 400 confirm_mismatch', async () => {
    const res = await call('POST', `${BASE}/recover`, {
      role: 'admin',
      mfa: 'fresh',
      body: { snapshotId: 's000000000000000000000001', confirm: 'recover' },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('confirm_mismatch');
  });

  it('reprovision with a confirmName matching neither slug nor name → 400 confirm_mismatch', async () => {
    const res = await call('POST', `${BASE}/reprovision`, {
      role: 'owner',
      mfa: 'fresh',
      body: { confirmName: 'not-the-project' },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('confirm_mismatch');
  });
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.BRIVEN_BETTER_AUTH_SECRET;
  else process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_DB_URL === undefined) delete process.env.BRIVEN_DATABASE_URL;
  else process.env.BRIVEN_DATABASE_URL = ORIGINAL_DB_URL;
});
