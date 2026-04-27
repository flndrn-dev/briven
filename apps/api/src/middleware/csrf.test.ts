import { describe, expect, test } from 'bun:test';

import { shouldRejectAsCsrf } from './csrf.js';

const trusted = ['https://briven.cloud', 'https://api.briven.cloud'];

describe('shouldRejectAsCsrf', () => {
  test('passes safe methods without inspecting Origin', () => {
    expect(
      shouldRejectAsCsrf({
        method: 'GET',
        hasSession: true,
        path: '/v1/projects',
        origin: null,
        trustedOrigins: trusted,
      }),
    ).toBe(false);
    expect(
      shouldRejectAsCsrf({
        method: 'HEAD',
        hasSession: true,
        path: '/v1/projects',
        origin: 'https://evil.example',
        trustedOrigins: trusted,
      }),
    ).toBe(false);
  });

  test('passes when no session cookie is attached (API-key or anonymous)', () => {
    expect(
      shouldRejectAsCsrf({
        method: 'POST',
        hasSession: false,
        path: '/v1/projects',
        origin: 'https://evil.example',
        trustedOrigins: trusted,
      }),
    ).toBe(false);
  });

  test('passes /v1/auth/* (Better Auth handles its own CSRF)', () => {
    expect(
      shouldRejectAsCsrf({
        method: 'POST',
        hasSession: true,
        path: '/v1/auth/sign-in/email',
        origin: 'https://evil.example',
        trustedOrigins: trusted,
      }),
    ).toBe(false);
  });

  test('rejects unsafe-method + session-cookie + missing Origin', () => {
    expect(
      shouldRejectAsCsrf({
        method: 'POST',
        hasSession: true,
        path: '/v1/projects',
        origin: null,
        trustedOrigins: trusted,
      }),
    ).toBe(true);
  });

  test('rejects unsafe-method + session-cookie + foreign Origin', () => {
    expect(
      shouldRejectAsCsrf({
        method: 'PATCH',
        hasSession: true,
        path: '/v1/projects/p_xxx/deployments/latest',
        origin: 'https://evil.example',
        trustedOrigins: trusted,
      }),
    ).toBe(true);
  });

  test('passes unsafe-method + session-cookie + trusted Origin', () => {
    expect(
      shouldRejectAsCsrf({
        method: 'POST',
        hasSession: true,
        path: '/v1/projects',
        origin: 'https://briven.cloud',
        trustedOrigins: trusted,
      }),
    ).toBe(false);
    expect(
      shouldRejectAsCsrf({
        method: 'DELETE',
        hasSession: true,
        path: '/v1/projects/p_xxx',
        origin: 'https://api.briven.cloud',
        trustedOrigins: trusted,
      }),
    ).toBe(false);
  });

  test('treats methods case-insensitively', () => {
    expect(
      shouldRejectAsCsrf({
        method: 'post',
        hasSession: true,
        path: '/v1/projects',
        origin: null,
        trustedOrigins: trusted,
      }),
    ).toBe(true);
  });
});
