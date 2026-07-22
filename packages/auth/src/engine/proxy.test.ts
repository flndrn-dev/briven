import { describe, expect, test } from 'bun:test';

import {
  appAuthPathToFdiSuffix,
  proxyBrivenEngineAuth,
  resolveFdiTarget,
} from './proxy.js';

describe('briven-engine first-party proxy', () => {
  test('maps app path to FDI suffix', () => {
    expect(appAuthPathToFdiSuffix('/api/auth/signup')).toBe('/signup');
    expect(appAuthPathToFdiSuffix('/api/auth/signinup/code')).toBe(
      '/signinup/code',
    );
    expect(appAuthPathToFdiSuffix('/api/auth/')).toBe('');
  });

  test('resolves FDI target on api origin', () => {
    expect(resolveFdiTarget({ apiOrigin: 'http://localhost:3001' })).toBe(
      'http://localhost:3001/v1/auth-core/fdi',
    );
  });

  test('forwards Set-Cookie from upstream onto app response', async () => {
    const upstream = new Response(JSON.stringify({ status: 'OK' }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie':
          'sAccessToken=abc; Path=/; HttpOnly, sRefreshToken=def; Path=/; HttpOnly',
      },
    });
    // Node/Bun may not multi set-cookie; simulate getSetCookie
    Object.defineProperty(upstream.headers, 'getSetCookie', {
      value: () => [
        'sAccessToken=abc; Path=/; HttpOnly',
        'sRefreshToken=def; Path=/; HttpOnly',
      ],
    });

    const fetchMock: typeof fetch = async () => upstream;
    const req = new Request('http://app.local/api/auth/signup', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    const res = await proxyBrivenEngineAuth(req, {
      apiOrigin: 'http://api.local',
      projectId: 'p_test',
      fetch: fetchMock,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-briven-proxy')).toBe('first-party');
    expect(res.headers.get('x-briven-engine')).toBe('briven-engine');
    const cookies =
      typeof (res.headers as Headers & { getSetCookie?: () => string[] })
        .getSetCookie === 'function'
        ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
        : [res.headers.get('set-cookie') ?? ''];
    const joined = cookies.join(' | ');
    expect(joined).toContain('sAccessToken=abc');
  });
});
