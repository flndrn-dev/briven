// apps/api/src/routes/projects.test.ts
//
// Probe test for Task A5: confirm `POST /v1/projects` is reachable under a
// CLI-minted Bearer JWT and is NOT shot down by the CSRF origin guard.
//
// Env vars must be set BEFORE any module that reads them is imported. The
// auth + db modules call into env at evaluation, so we mutate process.env
// first and pull every framework module in via dynamic import — mirroring
// the pattern in apps/api/src/routes/auth-cli.test.ts.
//
// We don't try to stand up postgres in unit tests. The KEY assertion is
// that the response status is NOT 403 csrf_origin_rejected. A 401 from
// the bearer user-lookup (missing row) or a 500 from the DB being
// unreachable are both acceptable — both prove the request made it past
// CSRF and reached the route handler / requireAuth bearer branch.

const ORIGINAL_SECRET = process.env.BRIVEN_BETTER_AUTH_SECRET;
const ORIGINAL_DB_URL = process.env.BRIVEN_DATABASE_URL;
process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET ?? 'a'.repeat(32);
process.env.BRIVEN_DATABASE_URL = ORIGINAL_DB_URL ?? 'postgres://test:test@127.0.0.1:5/test';

import { afterAll, describe, expect, it } from 'bun:test';
import type { AppEnv } from '../types/app-env.js';

describe('POST /v1/projects via CLI JWT', () => {
  it('accepts a Bearer cli token without rejecting on CSRF', async () => {
    const { Hono } = await import('hono');
    const { signCliToken } = await import('../lib/cli-jwt.js');
    const { csrfOriginCheck } = await import('../middleware/csrf.js');
    const { projectsRouter } = await import('./projects.js');

    const app = new Hono<AppEnv>();
    app.use('*', csrfOriginCheck());
    app.route('/', projectsRouter);

    const token = await signCliToken('u_proj_post_test');
    const res = await app.request('/v1/projects', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'cli-post-test', region: 'eu-west' }),
    });

    // No DB → 401 from bearer user-lookup or 500 from db acceptable.
    // KEY assertion: status is NOT 403 csrf_origin_rejected.
    expect(res.status).not.toBe(403);
  });
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.BRIVEN_BETTER_AUTH_SECRET;
  else process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_DB_URL === undefined) delete process.env.BRIVEN_DATABASE_URL;
  else process.env.BRIVEN_DATABASE_URL = ORIGINAL_DB_URL;
});
