import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

import { ValidationError } from '@briven/shared';

// why: master keys are read directly from process.env (not the cached
// `env` object) so a master-key rotation can take effect without an api
// process restart. Same regex validation that env.ts applies at boot.

/**
 * Per-tenant encrypted secret store — Layer 2 primitive shared between
 * briven auth and (future) briven pay.
 *
 * The wire format mirrors `services/project-env.ts` so anyone familiar with
 * the existing project-env encryption finds no surprises:
 *
 *   base64( <12-byte-iv> || <16-byte-gcm-tag> || <ciphertext> )
 *
 * What differs from project-env: the key is derived **per tenant** via
 * HKDF-SHA256, so a leak of one tenant's plaintext does not let an attacker
 * decrypt another tenant's blob. The `info=` byte string is service-scoped
 * (`briven-auth-v1` vs `briven-pay-v1`) so a leak of one service's master
 * key cannot decrypt the other service's secrets even if they share a
 * tenant id.
 *
 * Architecture contract: see `ARCHITECTURE.md` §4. This file is one of the
 * reuse points briven pay locks in for v1; do not change the key-derivation
 * inputs without a master-key-rotation migration plan.
 */

const SERVICE_INFO = {
  auth: Buffer.from('briven-auth-v1', 'utf8'),
  pay: Buffer.from('briven-pay-v1', 'utf8'),
} as const;
export type TenantService = keyof typeof SERVICE_INFO;

/**
 * Resolve the master key for a service. Returns 32 raw bytes. Throws a
 * `ValidationError` when the env var is missing or malformed — boot does
 * not fail, but the first request to a tenant for that service does. This
 * matches the existing `BRIVEN_ENCRYPTION_KEY` pattern in project-env.ts.
 */
function masterKey(service: TenantService): Buffer {
  const envVar = service === 'auth' ? 'BRIVEN_AUTH_MASTER_KEY' : 'BRIVEN_PAY_MASTER_KEY';
  const raw = process.env[envVar];
  if (!raw) {
    throw new ValidationError(`master key not configured for service: ${service}`);
  }
  if (!/^[0-9a-f]{64}$/i.test(raw)) {
    throw new ValidationError(
      `master key for ${service} must be 32 random bytes encoded as 64 hex characters`,
    );
  }
  return Buffer.from(raw, 'hex');
}

/**
 * Derive a per-tenant key. HKDF inputs:
 *   IKM  = service master key (32 bytes)
 *   salt = utf8 bytes of the project id (e.g. 'p_01HX...')
 *   info = service-scoped string ('briven-auth-v1' or 'briven-pay-v1')
 *
 * Output: 32 bytes suitable for AES-256-GCM.
 */
function tenantKey(service: TenantService, projectId: string): Buffer {
  if (!projectId || projectId.length === 0) {
    throw new ValidationError('projectId is required to derive a tenant key');
  }
  const ikm = masterKey(service);
  const salt = Buffer.from(projectId, 'utf8');
  const info = SERVICE_INFO[service];
  // hkdfSync returns ArrayBuffer; wrap as Buffer for the crypto APIs below.
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, 32));
}

export interface EncryptArgs {
  service: TenantService;
  projectId: string;
  plaintext: string;
}

export interface DecryptArgs {
  service: TenantService;
  projectId: string;
  ciphertext: string;
}

export function encryptTenantSecret({ service, projectId, plaintext }: EncryptArgs): string {
  const k = tenantKey(service, projectId);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptTenantSecret({ service, projectId, ciphertext }: DecryptArgs): string {
  const k = tenantKey(service, projectId);
  const buf = Buffer.from(ciphertext, 'base64');
  if (buf.length < 12 + 16 + 1) {
    throw new ValidationError('ciphertext too short — expected at least 29 bytes');
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const body = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

/**
 * Testing helper — visible for unit tests only. Not part of the public API.
 * The derived key is sensitive; do not log it. Returning it lets the test
 * harness assert isolation properties without re-deriving the key inline.
 */
export function __unsafe_tenantKey_forTesting(
  service: TenantService,
  projectId: string,
): Buffer {
  return tenantKey(service, projectId);
}
