/**
 * Two-factor + backup-code SDK contract (Sprint S1).
 * Pins the Better Auth path names and the twoFactorRequired result shape.
 */
import { describe, expect, mock, test } from 'bun:test';

import { createBrivenAuth } from '../index.js';

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  return mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = handler(url, init);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('twoFactor SDK paths + results', () => {
  test('signIn.email with twoFactorRedirect → twoFactorRequired', async () => {
    const auth = createBrivenAuth({
      projectId: 'p_test',
      publicKey: 'pk_briven_auth_test',
      fetch: mockFetch(() => ({ twoFactorRedirect: true })),
    });
    const result = await auth.signIn.email({ email: 'a@b.com', password: 'x' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('twoFactorRequired' in result && result.twoFactorRequired).toBe(true);
    }
  });

  test('twoFactor.verify posts to /two-factor/verify-totp (not /verify)', async () => {
    let seenPath = '';
    const auth = createBrivenAuth({
      projectId: 'p_test',
      publicKey: 'pk_briven_auth_test',
      fetch: mockFetch((url) => {
        seenPath = new URL(url).pathname;
        return {
          user: { id: 'u_1' },
          session: { expiresAt: '2099-01-01T00:00:00.000Z' },
        };
      }),
    });
    const result = await auth.twoFactor.verify('123456');
    expect(seenPath).toBe('/v1/auth-tenant/two-factor/verify-totp');
    expect(result.ok).toBe(true);
    if (result.ok && 'userId' in result) {
      expect(result.userId).toBe('u_1');
    }
  });

  test('twoFactor.verifyBackupCode posts to /two-factor/verify-backup-code', async () => {
    let seenPath = '';
    const auth = createBrivenAuth({
      projectId: 'p_test',
      publicKey: 'pk_briven_auth_test',
      fetch: mockFetch((url) => {
        seenPath = new URL(url).pathname;
        return {
          user: { id: 'u_1' },
          session: { expiresAt: '2099-01-01T00:00:00.000Z' },
        };
      }),
    });
    const result = await auth.twoFactor.verifyBackupCode('ABCD-1234');
    expect(seenPath).toBe('/v1/auth-tenant/two-factor/verify-backup-code');
    expect(result.ok).toBe(true);
  });

  test('generateBackupCodes forwards password in body', async () => {
    let body: unknown;
    const auth = createBrivenAuth({
      projectId: 'p_test',
      publicKey: 'pk_briven_auth_test',
      fetch: mockFetch((_url, init) => {
        body = init?.body ? JSON.parse(String(init.body)) : null;
        return { backupCodes: ['AAAA-1111', 'BBBB-2222'] };
      }),
    });
    const result = await auth.twoFactor.generateBackupCodes('s3cret');
    expect(body).toEqual({ password: 's3cret' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.codes).toHaveLength(2);
    }
  });
});
