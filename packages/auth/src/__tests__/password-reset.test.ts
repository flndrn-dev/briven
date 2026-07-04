/**
 * Unit tests for sendPasswordReset + resetPassword.
 * Fetch is mocked — no network calls made.
 *
 * Confirmed Better Auth 1.6.9 endpoints:
 *   POST /request-password-reset  { email }
 *   POST /reset-password          { token, newPassword }
 */

import { describe, it, expect } from 'bun:test';
import { createBrivenAuth } from '../index.js';

const PROJECT_ID = 'p_test123';
const PUBLIC_KEY = 'pk_briven_test';
const API_ORIGIN = 'https://api.briven.tech';
const PREFIX = '/v1/auth-tenant';

function makeClient(fetchMock: (url: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  return createBrivenAuth({
    projectId: PROJECT_ID,
    publicKey: PUBLIC_KEY,
    fetch: fetchMock as typeof fetch,
  });
}

function okResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// sendPasswordReset
// ---------------------------------------------------------------------------

describe('sendPasswordReset', () => {
  it('sends POST to /request-password-reset with email in body', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: unknown = null;
    let capturedHeaders: Record<string, string> = {};

    const auth = makeClient(async (url, init) => {
      capturedUrl = String(url);
      capturedMethod = (init?.method ?? 'GET').toUpperCase();
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      capturedHeaders = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      );
      return okResponse({ status: true, message: 'check your inbox' });
    });

    const result = await auth.sendPasswordReset('jane@example.com');

    expect(capturedUrl).toBe(`${API_ORIGIN}${PREFIX}/request-password-reset`);
    expect(capturedMethod).toBe('POST');
    expect(capturedBody).toEqual({ email: 'jane@example.com' });
    expect(capturedHeaders['x-briven-project-id']).toBe(PROJECT_ID);
    expect(capturedHeaders['authorization']).toBe(`Bearer ${PUBLIC_KEY}`);
    expect(result).toEqual({ ok: true });
  });

  it('returns { ok: true } even when server responds with status: true but no user', async () => {
    const auth = makeClient(async () => okResponse({ status: true }));
    expect(await auth.sendPasswordReset('x@x.com')).toEqual({ ok: true });
  });

  it('returns error frame when fetch throws (network failure)', async () => {
    const auth = makeClient(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await auth.sendPasswordReset('x@x.com');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('network_error');
      expect(typeof result.message).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// resetPassword
// ---------------------------------------------------------------------------

describe('resetPassword', () => {
  it('sends POST to /reset-password with token and newPassword', async () => {
    let capturedUrl = '';
    let capturedBody: unknown = null;

    const auth = makeClient(async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return okResponse({ status: true });
    });

    const result = await auth.resetPassword({ token: 'tok_abc123', newPassword: 'n3wP@ss!' });

    expect(capturedUrl).toBe(`${API_ORIGIN}${PREFIX}/reset-password`);
    expect(capturedBody).toEqual({ token: 'tok_abc123', newPassword: 'n3wP@ss!' });
    expect(result).toEqual({ ok: true });
  });

  it('returns { ok: true } when server body has status: true', async () => {
    const auth = makeClient(async () => okResponse({ status: true }));
    const result = await auth.resetPassword({ token: 't', newPassword: 'pw12345!' });
    expect(result).toEqual({ ok: true });
  });

  it('returns { ok: false } with server message when body lacks status: true', async () => {
    const auth = makeClient(async () =>
      okResponse({ code: 'INVALID_TOKEN', message: 'token is expired or invalid' }, 400),
    );
    const result = await auth.resetPassword({ token: 'bad', newPassword: 'pw' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('token is expired or invalid');
    }
  });

  it('returns { ok: false } with nested error.message', async () => {
    const auth = makeClient(async () =>
      okResponse({ error: { code: 'PASSWORD_TOO_SHORT', message: 'password too short' } }, 400),
    );
    const result = await auth.resetPassword({ token: 't', newPassword: 'a' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('password too short');
    }
  });

  it('returns error frame when fetch throws (network failure)', async () => {
    const auth = makeClient(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await auth.resetPassword({ token: 't', newPassword: 'p' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('network_error');
    }
  });
});
