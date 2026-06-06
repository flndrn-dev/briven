// apps/api/src/middleware/project-auth.test.ts
//
// Env vars must be set BEFORE any module that reads them is imported.
// cli-jwt.ts (via env.ts) and auth.ts both read process.env at module load,
// so mutate it first and then dynamic-import everything below.

const ORIGINAL_SECRET = process.env.BRIVEN_BETTER_AUTH_SECRET;
const ORIGINAL_DB_URL = process.env.BRIVEN_URL;
process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET ?? 'a'.repeat(32);
process.env.BRIVEN_URL = ORIGINAL_DB_URL ?? 'mysql://test:test@127.0.0.1:5/test';

import { describe, expect, it, afterAll } from 'bun:test';
import type { AppEnv } from '../types/app-env.js';

describe('requireProjectAuth — CLI JWT branch', () => {
  it('passes a CLI JWT through the auth gate (DB lookups may still fail downstream)', async () => {
    const { Hono } = await import('hono');
    const { signCliToken } = await import('../lib/cli-jwt.js');
    const { requireProjectAuth } = await import('./project-auth.js');

    const app = new Hono<AppEnv>();
    app.use('/v1/projects/:id/*', requireProjectAuth());
    app.get('/v1/projects/:id/probe', (c) => c.json({ ok: true }));

    const token = await signCliToken('u_proj_auth_jwt');
    const res = await app.request('/v1/projects/p_test/probe', {
      headers: { authorization: `Bearer ${token}` },
    });
    // Either:
    //  200 — DB present, user has access (unlikely in unit env)
    //  401 — DB present but user-lookup failed (acceptable: bearer branch executed)
    //  403 — bearer accepted, user found, no project access
    //  500 — DB unavailable in unit env (bearer branch executed)
    // CRITICAL: a 401 message must be specific to cli-jwt or project-access,
    // NOT the generic 'expected Bearer brk_*' error from the old code path.
    expect([200, 401, 403, 500]).toContain(res.status);
    if (res.status === 401) {
      const body = (await res.json()) as { message?: string };
      // Must NOT contain "brk_" — would prove the old API-key-only path ran.
      expect(body.message ?? '').not.toMatch(/brk_/i);
    }
  });
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.BRIVEN_BETTER_AUTH_SECRET;
  else process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_DB_URL === undefined) delete process.env.BRIVEN_URL;
  else process.env.BRIVEN_URL = ORIGINAL_DB_URL;
});
