/**
 * Per-project OAuth credentials (product rule 2026-07-27).
 * Platform env must not unlock social login for customer projects.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';

const loadMock = mock(
  async (
    _projectId: string,
  ): Promise<
    Array<{ thirdPartyId: string; clientId: string; clientSecret: string }>
  > => [],
);

mock.module('./project-config.js', () => ({
  loadProjectProviderSecrets: (projectId: string) => loadMock(projectId),
}));

// Import after mock so resolveProviderCredentials uses the stub.
const { resolveProviderCredentials } = await import('./thirdparty.js');

describe('resolveProviderCredentials — per-project only', () => {
  afterEach(() => {
    loadMock.mockClear();
    delete process.env.BRIVEN_KONNOS_CLIENT_ID;
    delete process.env.BRIVEN_KONNOS_CLIENT_SECRET;
    delete process.env.BRIVEN_GOOGLE_CLIENT_ID;
    delete process.env.BRIVEN_GOOGLE_CLIENT_SECRET;
  });

  test('returns project secrets when both id and secret are stored', async () => {
    loadMock.mockImplementation(async () => [
      {
        thirdPartyId: 'konnos',
        clientId: 'kc_mavi',
        clientSecret: 'sec_mavi',
      },
    ]);
    const creds = await resolveProviderCredentials('p_mavi', 'konnos');
    expect(creds).toEqual({
      clientId: 'kc_mavi',
      clientSecret: 'sec_mavi',
      source: 'project_secrets',
    });
  });

  test('does not use platform env when this project has no secrets', async () => {
    loadMock.mockImplementation(async () => []);
    process.env.BRIVEN_KONNOS_CLIENT_ID = 'kc_platform';
    process.env.BRIVEN_KONNOS_CLIENT_SECRET = 'sec_platform';
    const creds = await resolveProviderCredentials('p_other', 'konnos');
    expect(creds).toBeNull();
  });

  test('does not use platform env without a project id', async () => {
    process.env.BRIVEN_KONNOS_CLIENT_ID = 'kc_platform';
    process.env.BRIVEN_KONNOS_CLIENT_SECRET = 'sec_platform';
    expect(await resolveProviderCredentials(undefined, 'konnos')).toBeNull();
    expect(await resolveProviderCredentials('', 'konnos')).toBeNull();
    expect(await resolveProviderCredentials('   ', 'konnos')).toBeNull();
  });

  test('project A secrets do not apply when loader returns empty for project B', async () => {
    loadMock.mockImplementation(async (projectId: string) => {
      if (projectId === 'p_mavi') {
        return [
          {
            thirdPartyId: 'konnos',
            clientId: 'kc_mavi',
            clientSecret: 'sec_mavi',
          },
        ];
      }
      return [];
    });
    process.env.BRIVEN_KONNOS_CLIENT_ID = 'kc_platform';
    process.env.BRIVEN_KONNOS_CLIENT_SECRET = 'sec_platform';
    expect(await resolveProviderCredentials('p_mavi', 'konnos')).not.toBeNull();
    expect(await resolveProviderCredentials('p_cyberbear', 'konnos')).toBeNull();
  });

  test('same rule for google (no shared env fallback)', async () => {
    loadMock.mockImplementation(async () => []);
    process.env.BRIVEN_GOOGLE_CLIENT_ID = 'g_platform';
    process.env.BRIVEN_GOOGLE_CLIENT_SECRET = 'g_secret';
    expect(await resolveProviderCredentials('p_any', 'google')).toBeNull();
  });
});
