// apps/api/src/routes/platform-auth.test.ts
//
// Zone-2 regression test for the /platform/* Supabase-compat surface.
//
// Bug: requireProjectAuth was mounted on the `/platform/*` wildcard and read
// `c.req.param('id')`, but the routes use `:ref`. Hono resolves params against
// the *current* matched route only, so a wildcard `.use()` never sees a named
// param — `param('id')` was undefined → requireProjectAuth threw
// ForbiddenError('missing project id') (403) on EVERY /platform/* request, so
// the whole surface was dead.
//
// Fix: requireProjectAuth now takes a param name and is mounted PER-ROUTE as
// requireProjectAuth('ref'). With the ref param resolved, an UN-authenticated
// request gets past the "missing project id" check and falls through to the
// no-credential branch → UnauthorizedError (401).
//
// KEY assertion: status is 401 (param resolved), NOT 403 (the old
// missing-project-id failure). No DB is required — the 401 is thrown before
// any access lookup.

const ORIGINAL_SECRET = process.env.BRIVEN_BETTER_AUTH_SECRET;
const ORIGINAL_DB_URL = process.env.BRIVEN_DATABASE_URL;
process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET ?? 'a'.repeat(32);
process.env.BRIVEN_DATABASE_URL = ORIGINAL_DB_URL ?? 'postgres://test:test@127.0.0.1:5/test';

import { afterAll, describe, expect, it } from 'bun:test';

import type { AppEnv } from '../types/app-env.js';

describe('GET /platform/pg-meta/:ref/tables auth wiring', () => {
  it('resolves the :ref param (401 unauthenticated, not 403 missing-project-id)', async () => {
    const { Hono } = await import('hono');
    const { errorHandler } = await import('../middleware/error.js');
    const { platformRouter } = await import('./platform.js');

    const app = new Hono<AppEnv>();
    // attachSession would normally set user; here we send no session/token so
    // requireProjectAuth must fall through to its no-credential branch.
    app.use('*', async (c, next) => {
      c.set('user', null);
      await next();
    });
    app.route('/', platformRouter);
    app.onError(errorHandler);

    const res = await app.request('/platform/pg-meta/proj_ref_test/tables');

    // 401 proves the :ref param resolved (auth ran). A 403 would mean the
    // guard never saw the project id — the original bug.
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(403);
  });
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.BRIVEN_BETTER_AUTH_SECRET;
  else process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_DB_URL === undefined) delete process.env.BRIVEN_DATABASE_URL;
  else process.env.BRIVEN_DATABASE_URL = ORIGINAL_DB_URL;
});
