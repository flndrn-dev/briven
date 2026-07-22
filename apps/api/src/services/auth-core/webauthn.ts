/**
 * briven-engine passkeys on Doltgres with @simplewebauthn/server verification.
 */

import { randomBytes } from 'node:crypto';

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { newId } from '@briven/shared';

import { env } from '../../env.js';
import { log } from '../../lib/logger.js';
import { getEnginePool } from './db.js';
import { isAuthCoreInitialized } from './engine.js';
import { createEngineSession } from './native-session.js';
import { projectIdToTenantId } from './project-map.js';

function resolveTenant(projectId?: string, tenantId?: string): string {
  if (tenantId) return tenantId;
  if (projectId) return projectIdToTenantId(projectId);
  return 'public';
}

function rpIdFrom(input?: string): string {
  if (input) return input;
  try {
    return new URL(env.BRIVEN_WEB_ORIGIN ?? 'http://localhost:3000').hostname;
  } catch {
    return 'localhost';
  }
}

function originFrom(rpId: string): string {
  const web = env.BRIVEN_WEB_ORIGIN ?? 'http://localhost:3000';
  try {
    const u = new URL(web);
    return u.origin;
  } catch {
    return rpId === 'localhost' ? 'http://localhost:3000' : `https://${rpId}`;
  }
}

function b64urlToBuffer(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

export async function createRegistrationOptions(input: {
  userId: string;
  userName: string;
  projectId?: string;
  tenantId?: string;
  rpId?: string;
}): Promise<
  | {
      status: 'OK';
      challengeId: string;
      options: Awaited<ReturnType<typeof generateRegistrationOptions>>;
      engine: 'briven-engine';
      storage: 'doltgres';
    }
  | { status: 'ERROR'; message: string }
> {
  if (!isAuthCoreInitialized()) {
    return { status: 'ERROR', message: 'engine not ready' };
  }
  const tenantId = resolveTenant(input.projectId, input.tenantId);
  const rpID = rpIdFrom(input.rpId);
  const pool = getEnginePool();

  const existing = await pool.query(
    `SELECT credential_id, transports FROM be_webauthn_credentials WHERE user_id = $1`,
    [input.userId],
  );
  const excludeCredentials = (
    existing.rows as Array<{ credential_id: string; transports: string | null }>
  ).map((r) => ({
    id: r.credential_id,
    transports: (r.transports?.split(',').filter(Boolean) ??
      []) as AuthenticatorTransportFuture[],
  }));

  const options = await generateRegistrationOptions({
    rpName: 'Briven Auth',
    rpID,
    userName: input.userName,
    userID: new TextEncoder().encode(input.userId),
    userDisplayName: input.userName,
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  const challengeId = `wac_${randomBytes(12).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await pool.query(
    `INSERT INTO be_webauthn_challenges
      (challenge_id, tenant_id, user_id, challenge, type, expires_at)
     VALUES ($1, $2, $3, $4, 'registration', $5)`,
    [challengeId, tenantId, input.userId, options.challenge, expiresAt.toISOString()],
  );

  return {
    status: 'OK',
    challengeId,
    options,
    engine: 'briven-engine',
    storage: 'doltgres',
  };
}

export async function finishRegistration(input: {
  userId: string;
  challengeId: string;
  /** Full WebAuthn registration response JSON from navigator.credentials.create */
  response?: RegistrationResponseJSON;
  /** Legacy simplified path (local proofs without browser) */
  credentialId?: string;
  publicKey?: string;
  transports?: string[];
  projectId?: string;
  expectedOrigin?: string;
  rpId?: string;
}): Promise<{
  status: 'OK' | 'ERROR';
  message?: string;
  credentialDbId?: string;
  verified?: boolean;
}> {
  if (!isAuthCoreInitialized()) {
    return { status: 'ERROR', message: 'engine not ready' };
  }
  const pool = getEnginePool();
  const ch = await pool.query(
    `SELECT challenge, tenant_id, expires_at, user_id FROM be_webauthn_challenges
     WHERE challenge_id = $1 AND type = 'registration' LIMIT 1`,
    [input.challengeId],
  );
  const row = ch.rows[0] as
    | {
        challenge: string;
        tenant_id: string;
        expires_at: string | Date;
        user_id: string | null;
      }
    | undefined;
  if (!row || row.user_id !== input.userId) {
    return { status: 'ERROR', message: 'invalid challenge' };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { status: 'ERROR', message: 'challenge expired' };
  }

  const rpID = rpIdFrom(input.rpId);
  const expectedOrigin = input.expectedOrigin ?? originFrom(rpID);

  let credentialId: string;
  let publicKey: string;
  let counter = 0;
  let transports: string | null = null;
  let verified = false;

  if (input.response) {
    try {
      const verification = await verifyRegistrationResponse({
        response: input.response,
        expectedChallenge: row.challenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserVerification: false,
      });
      if (!verification.verified || !verification.registrationInfo) {
        return { status: 'ERROR', message: 'registration verification failed' };
      }
      const info = verification.registrationInfo;
      credentialId = Buffer.from(info.credential.id).toString('base64url');
      // credential.publicKey is Uint8Array
      publicKey = Buffer.from(info.credential.publicKey).toString('base64url');
      counter = info.credential.counter;
      transports = input.response.response.transports?.join(',') ?? null;
      verified = true;
    } catch (err) {
      log.warn('webauthn_register_verify_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
      return {
        status: 'ERROR',
        message: err instanceof Error ? err.message : 'verify failed',
      };
    }
  } else if (input.credentialId && input.publicKey) {
    // Dev/local simplified enrollment (no browser crypto)
    if (env.BRIVEN_ENV === 'production') {
      return {
        status: 'ERROR',
        message: 'full WebAuthn response required in production',
      };
    }
    credentialId = input.credentialId;
    publicKey = input.publicKey;
    transports = input.transports?.join(',') ?? null;
    verified = false;
  } else {
    return {
      status: 'ERROR',
      message: 'response (WebAuthn JSON) or credentialId+publicKey required',
    };
  }

  const id = newId('bwc');
  await pool.query(
    `INSERT INTO be_webauthn_credentials
      (id, user_id, tenant_id, credential_id, public_key, counter, transports)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, input.userId, row.tenant_id, credentialId, publicKey, counter, transports],
  );
  await pool.query(
    `DELETE FROM be_webauthn_challenges WHERE challenge_id = $1`,
    [input.challengeId],
  );
  return { status: 'OK', credentialDbId: id, verified };
}

export async function createAuthenticationOptions(input: {
  projectId?: string;
  tenantId?: string;
  userId?: string;
  rpId?: string;
}): Promise<
  | {
      status: 'OK';
      challengeId: string;
      options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
      engine: 'briven-engine';
      storage: 'doltgres';
    }
  | { status: 'ERROR'; message: string }
> {
  if (!isAuthCoreInitialized()) {
    return { status: 'ERROR', message: 'engine not ready' };
  }
  const tenantId = resolveTenant(input.projectId, input.tenantId);
  const rpID = rpIdFrom(input.rpId);
  const pool = getEnginePool();

  let allowCredentials:
    | Array<{ id: string; transports?: AuthenticatorTransportFuture[] }>
    | undefined;
  if (input.userId) {
    const creds = await pool.query(
      `SELECT credential_id, transports FROM be_webauthn_credentials WHERE user_id = $1`,
      [input.userId],
    );
    allowCredentials = (
      creds.rows as Array<{ credential_id: string; transports: string | null }>
    ).map((r) => ({
      id: r.credential_id,
      transports: (r.transports?.split(',').filter(Boolean) ??
        []) as AuthenticatorTransportFuture[],
    }));
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: 'preferred',
  });

  const challengeId = `wac_${randomBytes(12).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await pool.query(
    `INSERT INTO be_webauthn_challenges
      (challenge_id, tenant_id, user_id, challenge, type, expires_at)
     VALUES ($1, $2, $3, $4, 'authentication', $5)`,
    [
      challengeId,
      tenantId,
      input.userId ?? null,
      options.challenge,
      expiresAt.toISOString(),
    ],
  );

  return {
    status: 'OK',
    challengeId,
    options,
    engine: 'briven-engine',
    storage: 'doltgres',
  };
}

export async function finishAuthentication(input: {
  challengeId: string;
  credentialId?: string;
  /** Full WebAuthn authentication response */
  response?: AuthenticationResponseJSON;
  projectId?: string;
  expectedOrigin?: string;
  rpId?: string;
}): Promise<
  | {
      status: 'OK';
      userId: string;
      verified: boolean;
      session: {
        handle: string;
        userId: string;
        accessToken: string;
        refreshToken: string;
      };
    }
  | { status: 'ERROR'; message: string }
> {
  if (!isAuthCoreInitialized()) {
    return { status: 'ERROR', message: 'engine not ready' };
  }
  const pool = getEnginePool();
  const ch = await pool.query(
    `SELECT challenge, tenant_id, expires_at FROM be_webauthn_challenges
     WHERE challenge_id = $1 AND type = 'authentication' LIMIT 1`,
    [input.challengeId],
  );
  const row = ch.rows[0] as
    | { challenge: string; tenant_id: string; expires_at: string | Date }
    | undefined;
  if (!row) return { status: 'ERROR', message: 'invalid challenge' };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { status: 'ERROR', message: 'challenge expired' };
  }

  const credentialId =
    input.credentialId ?? input.response?.id ?? input.response?.rawId;
  if (!credentialId) {
    return { status: 'ERROR', message: 'credentialId required' };
  }

  const cred = await pool.query(
    `SELECT id, user_id, public_key, counter FROM be_webauthn_credentials
     WHERE tenant_id = $1 AND credential_id = $2 LIMIT 1`,
    [row.tenant_id, credentialId],
  );
  const c = cred.rows[0] as
    | {
        id: string;
        user_id: string;
        public_key: string;
        counter: string | number;
      }
    | undefined;
  if (!c) return { status: 'ERROR', message: 'unknown credential' };

  let verified = false;
  let newCounter = Number(c.counter) + 1;

  if (input.response) {
    const rpID = rpIdFrom(input.rpId);
    const expectedOrigin = input.expectedOrigin ?? originFrom(rpID);
    try {
      const verification = await verifyAuthenticationResponse({
        response: input.response,
        expectedChallenge: row.challenge,
        expectedOrigin,
        expectedRPID: rpID,
        credential: {
          id: credentialId,
          publicKey: b64urlToBuffer(c.public_key),
          counter: Number(c.counter),
        },
        requireUserVerification: false,
      });
      if (!verification.verified) {
        return { status: 'ERROR', message: 'authentication verification failed' };
      }
      verified = true;
      newCounter = verification.authenticationInfo.newCounter;
    } catch (err) {
      log.warn('webauthn_auth_verify_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
      return {
        status: 'ERROR',
        message: err instanceof Error ? err.message : 'verify failed',
      };
    }
  } else {
    // Local proof path without browser assertion
    if (env.BRIVEN_ENV === 'production') {
      return {
        status: 'ERROR',
        message: 'full WebAuthn response required in production',
      };
    }
    verified = false;
  }

  await pool.query(
    `UPDATE be_webauthn_credentials SET counter = $2 WHERE id = $1`,
    [c.id, newCounter],
  );
  await pool.query(
    `DELETE FROM be_webauthn_challenges WHERE challenge_id = $1`,
    [input.challengeId],
  );

  const session = await createEngineSession({
    userId: c.user_id,
    tenantId: row.tenant_id,
  });
  return {
    status: 'OK',
    userId: c.user_id,
    verified,
    session: {
      handle: session.sessionHandle,
      userId: session.userId,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    },
  };
}

export async function listPasskeys(userId: string): Promise<{
  engine: 'briven-engine';
  storage: 'doltgres';
  credentials: Array<{ id: string; credentialId: string; createdAt: string }>;
}> {
  if (!isAuthCoreInitialized()) {
    return { engine: 'briven-engine', storage: 'doltgres', credentials: [] };
  }
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT id, credential_id, created_at FROM be_webauthn_credentials
     WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return {
    engine: 'briven-engine',
    storage: 'doltgres',
    credentials: (
      res.rows as Array<{
        id: string;
        credential_id: string;
        created_at: Date | string;
      }>
    ).map((r) => ({
      id: r.id,
      credentialId: r.credential_id,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  };
}

export async function deletePasskey(
  userId: string,
  credentialDbId: string,
): Promise<{ ok: boolean }> {
  if (!isAuthCoreInitialized()) return { ok: false };
  const pool = getEnginePool();
  const res = await pool.query(
    `DELETE FROM be_webauthn_credentials WHERE id = $1 AND user_id = $2`,
    [credentialDbId, userId],
  );
  return { ok: (res.rowCount ?? 0) > 0 };
}
