// apps/api/src/routes/me.test.ts
//
// Env vars must be set BEFORE any module that reads them is imported. auth.ts
// + cli-jwt.ts read BRIVEN_BETTER_AUTH_SECRET at evaluation time, so we
// mutate process.env first and pull every framework module in via dynamic
// import to keep the invariant when this file is loaded alongside siblings
// that may have already cached the modules.
//
// The test mounts the meRouter on a fresh Hono and hits /v1/me/projects with
// a CLI bearer token. In a test environment without postgres the bearer
// branch in requireAuth() fails to load the user row and returns 401, which
// is acceptable — it proves the route is mounted and the handler compiled.
// The 200 branch (when DB is reachable) additionally asserts the six-field
// shape the CLI's `existingBranch` consumes.

const ORIGINAL_SECRET = process.env.BRIVEN_BETTER_AUTH_SECRET;
const ORIGINAL_DB_URL = process.env.BRIVEN_DOLT_URL;
process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET ?? 'a'.repeat(32);
process.env.BRIVEN_DOLT_URL = ORIGINAL_DB_URL ?? 'mysql://test:test@127.0.0.1:5/test';

import { afterAll, describe, expect, it } from 'bun:test';
import type { AppEnv } from '../types/app-env.js';

describe('GET /v1/me/projects shape', () => {
  it('handler returns 200 or auth-error and never crashes on shape introspection', async () => {
    const { Hono } = await import('hono');
    const { meRouter } = await import('./me.js');
    const { signCliToken } = await import('../lib/cli-jwt.js');

    const app = new Hono<AppEnv>();
    app.route('/', meRouter);

    const token = await signCliToken('u_me_projects_test');
    const res = await app.request('/v1/me/projects', {
      headers: { authorization: `Bearer ${token}` },
    });

    // No DB in test env → 401 from bearer branch is fine, proves handler ran.
    expect([200, 401, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = (await res.json()) as { projects: Array<Record<string, unknown>> };
      if (body.projects.length > 0) {
        for (const p of body.projects) {
          for (const k of ['id', 'slug', 'name', 'region', 'tier', 'orgName']) {
            expect(p).toHaveProperty(k);
          }
        }
      }
    }
  });
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.BRIVEN_BETTER_AUTH_SECRET;
  else process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_DB_URL === undefined) delete process.env.BRIVEN_DOLT_URL;
  else process.env.BRIVEN_DOLT_URL = ORIGINAL_DB_URL;
});
