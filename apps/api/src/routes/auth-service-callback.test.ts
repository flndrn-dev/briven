// apps/api/src/routes/auth-service-callback.test.ts
//
// Pure-function tests for normalizeTenantCallbacks() — the tenant-auth
// bridge's callback/redirect fix. The @briven/auth SDK sends `redirectTo`
// but Better Auth only reads `callbackURL`, and a relative callbackURL
// resolves against api.briven.tech instead of the calling app. These tests
// pin the seeding + absolutizing behavior without spinning up a server.
//
// Env vars must be set BEFORE any module that reads them is imported
// (auth-service.ts pulls in env.ts and the auth service graph at module
// evaluation), so we mutate process.env first and import dynamically —
// same pattern as auth-cli.test.ts.

const ORIGINAL_SECRET = process.env.BRIVEN_BETTER_AUTH_SECRET;
const ORIGINAL_DB_URL = process.env.BRIVEN_DATABASE_URL;
process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET ?? 'a'.repeat(32);
process.env.BRIVEN_DATABASE_URL = ORIGINAL_DB_URL ?? 'postgres://test:test@127.0.0.1:5/test';

import { afterAll, describe, expect, it } from 'bun:test';

const { normalizeTenantCallbacks } = await import('./auth-service.js');

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.BRIVEN_BETTER_AUTH_SECRET;
  else process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_DB_URL === undefined) delete process.env.BRIVEN_DATABASE_URL;
  else process.env.BRIVEN_DATABASE_URL = ORIGINAL_DB_URL;
});

describe('normalizeTenantCallbacks', () => {
  it('seeds callbackURL from redirectTo when callbackURL is absent', () => {
    const out = normalizeTenantCallbacks(
      { email: 'user@example.com', redirectTo: 'https://code.konnos.org/dashboard' },
      null,
    );
    expect(out.callbackURL).toBe('https://code.konnos.org/dashboard');
    // Original SDK field stays — Better Auth ignores unknown fields.
    expect(out.redirectTo).toBe('https://code.konnos.org/dashboard');
    expect(out.email).toBe('user@example.com');
  });

  it('does not overwrite an explicit callbackURL with redirectTo', () => {
    const out = normalizeTenantCallbacks(
      { callbackURL: 'https://app.example.com/a', redirectTo: 'https://app.example.com/b' },
      null,
    );
    expect(out.callbackURL).toBe('https://app.example.com/a');
  });

  it('absolutizes a relative callbackURL against the Origin', () => {
    const out = normalizeTenantCallbacks(
      { callbackURL: '/dashboard' },
      'https://code.konnos.org',
    );
    expect(out.callbackURL).toBe('https://code.konnos.org/dashboard');
  });

  it('seeds from a relative redirectTo, then absolutizes it', () => {
    const out = normalizeTenantCallbacks(
      { email: 'user@example.com', redirectTo: '/dashboard' },
      'https://code.konnos.org',
    );
    expect(out.callbackURL).toBe('https://code.konnos.org/dashboard');
  });

  it('absolutizes newUserCallbackURL and errorCallbackURL too', () => {
    const out = normalizeTenantCallbacks(
      { callbackURL: '/in', newUserCallbackURL: '/welcome', errorCallbackURL: '/oops' },
      'https://code.konnos.org',
    );
    expect(out.callbackURL).toBe('https://code.konnos.org/in');
    expect(out.newUserCallbackURL).toBe('https://code.konnos.org/welcome');
    expect(out.errorCallbackURL).toBe('https://code.konnos.org/oops');
  });

  it('leaves an absolute callbackURL untouched (originCheck validates it downstream)', () => {
    const out = normalizeTenantCallbacks(
      { callbackURL: 'https://elsewhere.example.com/dashboard' },
      'https://code.konnos.org',
    );
    expect(out.callbackURL).toBe('https://elsewhere.example.com/dashboard');
  });

  it('ignores protocol-relative "//evil.com" (not an app-relative path)', () => {
    const out = normalizeTenantCallbacks(
      { callbackURL: '//evil.com/steal' },
      'https://code.konnos.org',
    );
    expect(out.callbackURL).toBe('//evil.com/steal');
  });

  it('returns body unchanged when origin is null', () => {
    const body = { callbackURL: '/dashboard' };
    const out = normalizeTenantCallbacks(body, null);
    expect(out).toEqual(body);
  });

  it('returns body unchanged when origin is garbage or non-http(s)', () => {
    const body = { callbackURL: '/dashboard' };
    expect(normalizeTenantCallbacks(body, 'not a url at all')).toEqual(body);
    expect(normalizeTenantCallbacks(body, 'ftp://files.example.com')).toEqual(body);
    expect(normalizeTenantCallbacks(body, '')).toEqual(body);
  });

  it('does not invent fields when neither redirectTo nor callbackURL is present', () => {
    const body = { email: 'user@example.com' };
    const out = normalizeTenantCallbacks(body, 'https://code.konnos.org');
    expect(out).toEqual(body);
    expect('callbackURL' in out).toBe(false);
    expect('newUserCallbackURL' in out).toBe(false);
    expect('errorCallbackURL' in out).toBe(false);
  });

  it('ignores non-string redirectTo and non-string callback fields', () => {
    const out = normalizeTenantCallbacks(
      { redirectTo: 42, callbackURL: ['/dashboard'] },
      'https://code.konnos.org',
    );
    expect(out.callbackURL).toEqual(['/dashboard']);
    expect('newUserCallbackURL' in out).toBe(false);
  });
});
