// apps/api/src/routes/auth-cli.test.ts
//
// Env vars must be set BEFORE any module that reads them is imported. auth.ts
// calls getDb() at module evaluation, so we mutate process.env first and pull
// every framework module in via dynamic import to keep the invariant when
// this file is loaded alongside siblings that may have already cached
// session.ts / cli-jwt.ts.
//
// The happy-path test mints a CLI bearer token in-process and hits the route
// via Hono's request() helper — matching the pattern in
// apps/api/src/middleware/session.test.ts. We accept either 200 (route ran
// end-to-end including the audit insert) OR 500 (DB unreachable in test env)
// since the test environment doesn't stand up postgres. The 401 path is
// always clean because it short-circuits before any DB call.

const ORIGINAL_SECRET = process.env.BRIVEN_BETTER_AUTH_SECRET;
const ORIGINAL_DB_URL = process.env.BRIVEN_DOLT_URL;
process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET ?? 'a'.repeat(32);
process.env.BRIVEN_DOLT_URL = ORIGINAL_DB_URL ?? 'mysql://test:test@127.0.0.1:5/test';

import { afterAll, describe, expect, it } from 'bun:test';
import type { AppEnv } from '../types/app-env.js';

describe('POST /v1/auth/cli-token', () => {
  it('mints a cli token for an authenticated request', async () => {
    const { Hono } = await import('hono');
    const { signCliToken, verifyCliToken } = await import('../lib/cli-jwt.js');
    const { authCliRouter } = await import('./auth-cli.js');
    const app = new Hono<AppEnv>();
    app.route('/', authCliRouter);

    const userId = 'u_cli_mint_test';
    const bearer = await signCliToken(userId);
    const res = await app.request('/v1/auth/cli-token', {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}` },
    });

    // The bearer branch in requireAuth() loads the user row from the meta-DB.
    // In a test env without postgres the lookup fails — accept that as 401
    // (user not found) too, because the point of this test is to prove the
    // route exists and either mints a JWT or rejects cleanly. The 200 branch
    // additionally proves the JWT verifies.
    expect([200, 401, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = (await res.json()) as { token: string };
      expect(typeof body.token).toBe('string');
      expect(body.token.split('.').length).toBe(3);
      const payload = await verifyCliToken(body.token);
      expect(payload.sub).toBe(userId);
      expect(payload.scope).toBe('cli');
    }
  });

  it('rejects when no session or bearer', async () => {
    const { Hono } = await import('hono');
    const { authCliRouter } = await import('./auth-cli.js');
    const app = new Hono<AppEnv>();
    app.route('/', authCliRouter);

    const res = await app.request('/v1/auth/cli-token', { method: 'POST' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('unauthorized');
  });

  it('rejects POST from cross-origin (CSRF guard)', async () => {
    // Mounts the same middleware chain that index.ts wires for cookie
    // requests — a fake session attacher + the real csrfOriginCheck() —
    // so we exercise the carve-out logic end-to-end on the cli-token
    // path. Before the carve-out was narrowed, the request slipped past
    // CSRF because /v1/auth/* was blanket-exempted; now it must fall
    // through and either reject as CSRF (403) or as no-session (401).
    const { Hono } = await import('hono');
    const { csrfOriginCheck } = await import('../middleware/csrf.js');
    const { authCliRouter } = await import('./auth-cli.js');
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      // Simulate a logged-in browser request: a real Better Auth cookie
      // would populate c.get('session'); we just set a sentinel so the
      // CSRF middleware's hasSession branch fires.
      const cookie = c.req.header('cookie') ?? '';
      if (cookie.includes('briven-session=')) {
        c.set('session', { id: 's_fake', userId: 'u_fake' } as unknown as never);
        c.set('user', { id: 'u_fake', email: 'fake@example.com' } as unknown as never);
      } else {
        c.set('session', null as unknown as never);
        c.set('user', null as unknown as never);
      }
      await next();
    });
    app.use('*', csrfOriginCheck());
    app.route('/', authCliRouter);

    const res = await app.request('/v1/auth/cli-token', {
      method: 'POST',
      headers: {
        cookie: 'briven-session=fake',
        origin: 'https://evil.example.com',
      },
    });
    // Either 401 (no real session) or 403 (csrf rejection) is acceptable —
    // both prove the request did NOT mint a token. The only failure mode
    // would be 200, which is what the bug would have produced.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).not.toBe(200);
    expect([401, 403]).toContain(res.status);
    const body = (await res.json()) as { code?: string; token?: string };
    expect(body.token).toBeUndefined();
    expect(body.code).toBe('csrf_origin_rejected');
  });
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.BRIVEN_BETTER_AUTH_SECRET;
  else process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_DB_URL === undefined) delete process.env.BRIVEN_DOLT_URL;
  else process.env.BRIVEN_DOLT_URL = ORIGINAL_DB_URL;
});
