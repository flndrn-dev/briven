import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';

import { requireAuthCoreDashboard } from './auth-core-guard.js';

describe('briven-engine dashboard guard', () => {
  test('rejects anonymous with engine brand', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('user', null);
      c.set('session', null);
      await next();
    });
    app.use('*', requireAuthCoreDashboard());
    app.get('/x', (c) => c.json({ ok: true }));

    const res = await app.request('http://localhost/x');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { engine?: string; code?: string };
    expect(body.engine).toBe('briven-engine');
    expect(body.code).toBe('unauthorized');
  });
});
