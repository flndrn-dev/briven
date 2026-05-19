import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';

import { ValidationError } from '@briven/shared';

// Master keys must be present before the module reads them. Env is loaded
// once at import time via zod, so we set the values *before* importing.
const AUTH_KEY = randomBytes(32).toString('hex');
const PAY_KEY = randomBytes(32).toString('hex');

const originalAuth = process.env.BRIVEN_AUTH_MASTER_KEY;
const originalPay = process.env.BRIVEN_PAY_MASTER_KEY;

beforeAll(() => {
  process.env.BRIVEN_AUTH_MASTER_KEY = AUTH_KEY;
  process.env.BRIVEN_PAY_MASTER_KEY = PAY_KEY;
});

afterAll(() => {
  if (originalAuth === undefined) delete process.env.BRIVEN_AUTH_MASTER_KEY;
  else process.env.BRIVEN_AUTH_MASTER_KEY = originalAuth;
  if (originalPay === undefined) delete process.env.BRIVEN_PAY_MASTER_KEY;
  else process.env.BRIVEN_PAY_MASTER_KEY = originalPay;
});

// Dynamic import so the env-keyed initialiser runs after we set the keys.
async function loadStore() {
  return import('./tenant-secret-store.js');
}

describe('tenant-secret-store — Layer 2 primitive (ARCHITECTURE.md §4)', () => {
  test('encrypt then decrypt roundtrips for the same service + projectId', async () => {
    const { encryptTenantSecret, decryptTenantSecret } = await loadStore();
    const plaintext = 'gho_supersecret_oauth_client_secret_123';
    const blob = encryptTenantSecret({
      service: 'auth',
      projectId: 'p_alpha',
      plaintext,
    });
    expect(typeof blob).toBe('string');
    expect(blob.length).toBeGreaterThan(0);
    const out = decryptTenantSecret({
      service: 'auth',
      projectId: 'p_alpha',
      ciphertext: blob,
    });
    expect(out).toBe(plaintext);
  });

  test('different projectIds produce different ciphertexts for the same plaintext', async () => {
    const { encryptTenantSecret } = await loadStore();
    const a = encryptTenantSecret({ service: 'auth', projectId: 'p_alpha', plaintext: 'x' });
    const b = encryptTenantSecret({ service: 'auth', projectId: 'p_bravo', plaintext: 'x' });
    expect(a).not.toBe(b);
  });

  test('cross-tenant decrypt fails — tenant A cannot read tenant B (forward isolation)', async () => {
    const { encryptTenantSecret, decryptTenantSecret } = await loadStore();
    const blob = encryptTenantSecret({
      service: 'auth',
      projectId: 'p_alpha',
      plaintext: 'tenant-A-only',
    });
    expect(() =>
      decryptTenantSecret({ service: 'auth', projectId: 'p_bravo', ciphertext: blob }),
    ).toThrow(); // GCM tag mismatch
  });

  test('cross-service decrypt fails — auth secret unreadable by pay key (service isolation)', async () => {
    const { encryptTenantSecret, decryptTenantSecret } = await loadStore();
    const blob = encryptTenantSecret({
      service: 'auth',
      projectId: 'p_alpha',
      plaintext: 'auth-side-only',
    });
    expect(() =>
      decryptTenantSecret({ service: 'pay', projectId: 'p_alpha', ciphertext: blob }),
    ).toThrow();
  });

  test('tampered ciphertext is rejected (AES-GCM auth tag verification)', async () => {
    const { encryptTenantSecret, decryptTenantSecret } = await loadStore();
    const blob = encryptTenantSecret({
      service: 'auth',
      projectId: 'p_alpha',
      plaintext: 'integrity-matters',
    });
    // Flip a single byte in the body (after iv+tag).
    const buf = Buffer.from(blob, 'base64');
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff;
    const tampered = buf.toString('base64');
    expect(() =>
      decryptTenantSecret({ service: 'auth', projectId: 'p_alpha', ciphertext: tampered }),
    ).toThrow();
  });

  test('truncated ciphertext returns ValidationError (length sanity)', async () => {
    const { decryptTenantSecret } = await loadStore();
    expect(() =>
      decryptTenantSecret({
        service: 'auth',
        projectId: 'p_alpha',
        ciphertext: Buffer.from('toosmall').toString('base64'),
      }),
    ).toThrow(ValidationError);
  });

  test('empty projectId rejected — no tenant key without a tenant', async () => {
    const { encryptTenantSecret } = await loadStore();
    expect(() =>
      encryptTenantSecret({ service: 'auth', projectId: '', plaintext: 'x' }),
    ).toThrow(ValidationError);
  });

  test('different services with the same projectId derive different keys', async () => {
    const { __unsafe_tenantKey_forTesting } = await loadStore();
    const k1 = __unsafe_tenantKey_forTesting('auth', 'p_alpha');
    const k2 = __unsafe_tenantKey_forTesting('pay', 'p_alpha');
    expect(k1.equals(k2)).toBe(false);
  });

  test('same service + same projectId is deterministic across calls', async () => {
    const { __unsafe_tenantKey_forTesting } = await loadStore();
    const k1 = __unsafe_tenantKey_forTesting('auth', 'p_alpha');
    const k2 = __unsafe_tenantKey_forTesting('auth', 'p_alpha');
    expect(k1.equals(k2)).toBe(true);
  });
});
