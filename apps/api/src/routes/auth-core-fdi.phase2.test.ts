/**
 * Phase 2 FDI surface — mount check.
 * Sets dummy control-plane URL so env/auth side-effects don't crash unit tests.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';

process.env.BRIVEN_DATABASE_URL =
  process.env.BRIVEN_DATABASE_URL ??
  'postgres://postgres:devpass@127.0.0.1:5434/postgres?sslmode=disable';
process.env.BRIVEN_AUTH_CORE_ENABLED = process.env.BRIVEN_AUTH_CORE_ENABLED ?? 'true';
process.env.BRIVEN_ENGINE_DATABASE_URL =
  process.env.BRIVEN_ENGINE_DATABASE_URL ??
  'postgres://postgres:devpass@127.0.0.1:5434/briven_engine?sslmode=disable';
process.env.BRIVEN_DATA_PLANE_URL =
  process.env.BRIVEN_DATA_PLANE_URL ??
  'postgres://postgres:devpass@127.0.0.1:5434/postgres?sslmode=disable';

describe('Phase 2 FDI routes mounted', () => {
  let app: Hono;

  beforeAll(async () => {
    const { authCoreFdiRouter } = await import('./auth-core-fdi.js');
    const { authCoreSessionRouter } = await import('./auth-core-session.js');
    const { authCoreStatusRouter } = await import('./auth-core-status.js');
    app = new Hono();
    app.route('/', authCoreStatusRouter);
    app.route('/', authCoreFdiRouter);
    app.route('/', authCoreSessionRouter);
  });

  test('signup without project/key is unauthorized (not 404)', async () => {
    const res = await app.request('http://localhost/v1/auth-core/fdi/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    // Locked FDI: 401 without project+pk; 503 if engine not ready.
    expect([401, 403, 400, 503]).toContain(res.status);
    expect(res.status).not.toBe(404);
  });

  test('signin without project/key is unauthorized (not 404)', async () => {
    const res = await app.request('http://localhost/v1/auth-core/fdi/signin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect([401, 403, 400, 503]).toContain(res.status);
    expect(res.status).not.toBe(404);
  });

  test('session/me returns not-ready or unauthenticated (not 404)', async () => {
    const res = await app.request('http://localhost/v1/auth-core/session/me');
    expect([401, 503]).toContain(res.status);
    expect(res.status).not.toBe(404);
  });
});
