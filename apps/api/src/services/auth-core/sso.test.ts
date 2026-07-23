import { describe, expect, test } from 'bun:test';

import { publicSsoConnection, type SsoConnection } from './sso.js';

describe('enterprise SSO helpers', () => {
  test('publicSsoConnection strips secrets and flags productionReady', () => {
    const conn: SsoConnection = {
      id: 'bsc_x',
      projectId: 'p_1',
      tenantId: 'proj-p-1',
      name: 'Okta',
      providerType: 'oidc',
      domains: ['acme.com'],
      config: {
        issuer: 'https://example.okta.com',
        clientId: 'cid',
        clientSecret: 'secret',
      },
      jitEnabled: true,
      deactivatedAt: null,
      createdAt: new Date().toISOString(),
      ready: true,
    };
    const pub = publicSsoConnection(conn);
    expect((pub as { config?: unknown }).config).toBeUndefined();
    expect(pub.productionReady).toBe(true);
    expect(pub.configKeys).toContain('clientSecret');
    expect(pub.name).toBe('Okta');
  });

  test('incomplete connection is not productionReady', () => {
    const conn: SsoConnection = {
      id: 'bsc_y',
      projectId: 'p_1',
      tenantId: 'proj-p-1',
      name: 'Draft',
      providerType: 'saml',
      domains: [],
      config: { idpSsoUrl: 'https://idp.example/sso' },
      jitEnabled: true,
      deactivatedAt: null,
      createdAt: new Date().toISOString(),
      ready: false,
    };
    expect(publicSsoConnection(conn).productionReady).toBe(false);
  });
});
