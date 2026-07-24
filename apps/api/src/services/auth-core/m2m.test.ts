import { describe, expect, test } from 'bun:test';

const ORIGINAL_SECRET = process.env.BRIVEN_BETTER_AUTH_SECRET;
process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET ?? 'a'.repeat(32);

import {
  isM2mRole,
  signM2mAccessToken,
  verifyM2mAccessToken,
  M2M_TOKEN_TTL_SECONDS,
} from './m2m.js';

describe('briven-engine M2M', () => {
  test('role allowlist', () => {
    expect(isM2mRole('viewer')).toBe(true);
    expect(isM2mRole('developer')).toBe(true);
    expect(isM2mRole('admin')).toBe(true);
    expect(isM2mRole('owner')).toBe(false);
    expect(isM2mRole('')).toBe(false);
  });

  test('access token signs and verifies with project + role', async () => {
    const { accessToken, expiresIn } = await signM2mAccessToken({
      clientId: 'm2m_testclient',
      projectId: 'p_test_project',
      role: 'developer',
    });
    expect(expiresIn).toBe(M2M_TOKEN_TTL_SECONDS);
    expect(accessToken.split('.').length).toBe(3);

    const payload = await verifyM2mAccessToken(accessToken);
    expect(payload.scope).toBe('m2m');
    expect(payload.project_id).toBe('p_test_project');
    expect(payload.role).toBe('developer');
    expect(payload.client_id).toBe('m2m_testclient');
    expect(payload.sub).toBe('m2m_testclient');
  });

  test('tampered token fails verify', async () => {
    const { accessToken } = await signM2mAccessToken({
      clientId: 'm2m_x',
      projectId: 'p_y',
      role: 'viewer',
    });
    const parts = accessToken.split('.');
    parts[2] = parts[2]!.slice(0, -4) + 'xxxx';
    await expect(verifyM2mAccessToken(parts.join('.'))).rejects.toBeTruthy();
  });
});
