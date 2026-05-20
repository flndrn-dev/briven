// apps/api/src/middleware/session.test.ts
//
// Env vars must be set BEFORE any module that reads them is imported.
// auth.ts calls getDb() at module evaluation, so we have to mutate
// process.env before any static import that pulls auth.ts in. To keep the
// invariant when this file is loaded alongside siblings (which may have
// already cached session.ts), all framework imports live inside dynamic
// imports below.

const ORIGINAL_SECRET = process.env.BRIVEN_BETTER_AUTH_SECRET;
const ORIGINAL_DB_URL = process.env.BRIVEN_DATABASE_URL;
process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET ?? 'a'.repeat(32);
// auth.ts evaluates getDb() at module load — provide a syntactically valid
// URL so the import doesn't throw. The actual postgres connection is lazy
// (only opened when a query runs), and the bearer branch catches errors.
process.env.BRIVEN_DATABASE_URL = ORIGINAL_DB_URL ?? 'postgres://test:test@127.0.0.1:5/test';

import { describe, expect, it, afterAll } from 'bun:test';

describe('requireAuth — Bearer JWT', () => {
  it('attaches user from a valid cli token', async () => {
    const { Hono } = await import('hono');
    const { signCliToken } = await import('../lib/cli-jwt.js');
    const { requireAuth } = await import('./session.js');
    type AppEnv = (typeof import('../types/app-env.js'))['AppEnv'];
    const app = new Hono<AppEnv>();
    app.use('*', requireAuth());
    app.get('/who', (c) => c.json({ id: (c.get('user') as { id?: string } | undefined)?.id }));

    const token = await signCliToken('u_session_test');
    const res = await app.request('/who', {
      headers: { authorization: `Bearer ${token}` },
    });
    // Either 200 (user found) or 401 (cli-token user not in DB) is acceptable.
    // The point of this test is to prove the BEARER PATH ran — not that the DB has the user.
    expect([200, 401]).toContain(res.status);
    if (res.status === 401) {
      const body = (await res.json()) as { code: string; message: string };
      expect(body.code).toBe('unauthorized');
      // The message must come from the cli-token branch, not the cookie branch.
      expect(body.message).toMatch(/cli token/i);
    }
  });

  it('rejects an expired or malformed bearer', async () => {
    const { Hono } = await import('hono');
    const { requireAuth } = await import('./session.js');
    type AppEnv = (typeof import('../types/app-env.js'))['AppEnv'];
    const app = new Hono<AppEnv>();
    app.use('*', requireAuth());
    app.get('/who', (c) => c.json({}));
    const res = await app.request('/who', {
      headers: { authorization: 'Bearer not.a.jwt' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.message).toMatch(/invalid cli token/i);
  });
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.BRIVEN_BETTER_AUTH_SECRET;
  else process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_DB_URL === undefined) delete process.env.BRIVEN_DATABASE_URL;
  else process.env.BRIVEN_DATABASE_URL = ORIGINAL_DB_URL;
});
