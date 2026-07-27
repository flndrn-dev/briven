/**
 * briven-engine passkeys on Doltgres with @simplewebauthn/server verification.
 *
 * rpId / expectedOrigin MUST match the app host the user is on (e.g.
 * pay.mavifinans.sh for mavi pay) — never hard-code briven.tech for tenant apps.
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
import { getBrivenEngineAppOrigins, getBrivenEngineBranding } from './project-config.js';
import { projectIdToTenantId } from './project-map.js';

function resolveTenant(projectId?: string, tenantId?: string): string {
  if (tenantId) return tenantId;
  if (projectId) return projectIdToTenantId(projectId);
  return 'public';
}

function normalizeHttpOrigin(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.protocol === 'http:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
      return null;
    }
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * rpId must equal the origin hostname, or be a parent domain of it
 * (WebAuthn registrable-domain rule, simplified).
 */
export function rpIdMatchesOrigin(rpId: string, origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    const rp = rpId.toLowerCase().replace(/^\./, '');
    if (!rp || !host) return false;
    return host === rp || host.endsWith(`.${rp}`);
  } catch {
    return false;
  }
}

/**
 * Resolve which website "owns" this passkey ceremony.
 *
 * Priority:
 *  1) explicit expectedOrigin / rpId from the app (mavi sends window.location)
 *  2) browser Origin header (proxied by first-party /api/auth)
 *  3) project's Allowed Domains list
 *  4) last resort: BRIVEN_WEB_ORIGIN (hosted Briven only — not tenant apps)
 */
export async function resolveWebAuthnRp(input: {
  projectId?: string;
  rpId?: string | null;
  expectedOrigin?: string | null;
  /** Origin header from the browser (or first-party proxy). */
  requestOrigin?: string | null;
}): Promise<
  | { ok: true; rpId: string; expectedOrigin: string; rpName: string }
  | { ok: false; message: string }
> {
  const allowed = input.projectId
    ? await getBrivenEngineAppOrigins(input.projectId)
    : [];

  const candidates: string[] = [];
  const push = (raw: string | null | undefined) => {
    const o = normalizeHttpOrigin(raw);
    if (o && !candidates.includes(o)) candidates.push(o);
  };
  push(input.expectedOrigin);
  push(input.requestOrigin);
  for (const a of allowed) push(a);

  // Hosted dashboard only — never preferred when the project has its own apps.
  if (candidates.length === 0) {
    push(env.BRIVEN_WEB_ORIGIN ?? null);
  }

  let expectedOrigin: string | null = null;
  for (const o of candidates) {
    if (allowed.length === 0 || allowed.includes(o)) {
      expectedOrigin = o;
      break;
    }
  }
  // If Allowed Domains is empty, still accept https app origin from the request
  // (first-day projects before they finish the domain checklist).
  if (!expectedOrigin && candidates[0]) {
    expectedOrigin = candidates[0];
  }
  if (!expectedOrigin) {
    return {
      ok: false,
      message:
        'Passkey needs an app origin. Open your app over HTTPS and add it under Auth → Allowed Domains.',
    };
  }

  let rpId = (input.rpId ?? '').trim().toLowerCase() || null;
  if (rpId && !rpIdMatchesOrigin(rpId, expectedOrigin)) {
    // Ignore a mismatched client rpId; derive from origin instead.
    rpId = null;
  }
  if (!rpId) {
    try {
      rpId = new URL(expectedOrigin).hostname;
    } catch {
      return { ok: false, message: 'invalid passkey origin' };
    }
  }

  let rpName = 'Briven Auth';
  if (input.projectId) {
    try {
      const brand = await getBrivenEngineBranding(input.projectId);
      if (brand.senderName?.trim()) rpName = brand.senderName.trim();
    } catch {
      /* keep default */
    }
  }

  return { ok: true, rpId, expectedOrigin, rpName };
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
  expectedOrigin?: string;
  requestOrigin?: string | null;
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
  const rp = await resolveWebAuthnRp({
    projectId: input.projectId,
    rpId: input.rpId,
    expectedOrigin: input.expectedOrigin,
    requestOrigin: input.requestOrigin,
  });
  if (!rp.ok) return { status: 'ERROR', message: rp.message };
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
    rpName: rp.rpName,
    rpID: rp.rpId,
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
  await insertWebauthnChallenge(pool, {
    challengeId,
    tenantId,
    userId: input.userId,
    challenge: options.challenge,
    type: 'registration',
    expiresAt: expiresAt.toISOString(),
    rpId: rp.rpId,
    expectedOrigin: rp.expectedOrigin,
  });

  return {
    status: 'OK',
    challengeId,
    options,
    engine: 'briven-engine',
    storage: 'doltgres',
  };
}

let rpColumnsReady: Promise<boolean> | null = null;
/** Best-effort: add rp_id / expected_origin on challenges (Doltgres/Postgres). */
async function ensureWebauthnRpColumns(
  pool: ReturnType<typeof getEnginePool>,
): Promise<boolean> {
  if (!rpColumnsReady) {
    rpColumnsReady = (async () => {
      try {
        await pool.query(
          `ALTER TABLE be_webauthn_challenges ADD COLUMN IF NOT EXISTS rp_id TEXT`,
        );
        await pool.query(
          `ALTER TABLE be_webauthn_challenges ADD COLUMN IF NOT EXISTS expected_origin TEXT`,
        );
        return true;
      } catch (err) {
        log.warn('webauthn_rp_columns_ensure_failed', {
          message: err instanceof Error ? err.message : String(err),
        });
        rpColumnsReady = null;
        return false;
      }
    })();
  }
  return rpColumnsReady;
}

async function insertWebauthnChallenge(
  pool: ReturnType<typeof getEnginePool>,
  row: {
    challengeId: string;
    tenantId: string;
    userId: string | null;
    challenge: string;
    type: 'registration' | 'authentication';
    expiresAt: string;
    rpId: string;
    expectedOrigin: string;
  },
): Promise<void> {
  const hasCols = await ensureWebauthnRpColumns(pool);
  if (hasCols) {
    try {
      await pool.query(
        `INSERT INTO be_webauthn_challenges
          (challenge_id, tenant_id, user_id, challenge, type, expires_at, rp_id, expected_origin)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          row.challengeId,
          row.tenantId,
          row.userId,
          row.challenge,
          row.type,
          row.expiresAt,
          row.rpId,
          row.expectedOrigin,
        ],
      );
      return;
    } catch {
      /* fall through to legacy insert */
    }
  }
  await pool.query(
    `INSERT INTO be_webauthn_challenges
      (challenge_id, tenant_id, user_id, challenge, type, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      row.challengeId,
      row.tenantId,
      row.userId,
      row.challenge,
      row.type,
      row.expiresAt,
    ],
  );
}

async function loadWebauthnChallenge(
  pool: ReturnType<typeof getEnginePool>,
  challengeId: string,
  type: 'registration' | 'authentication',
): Promise<{
  challenge: string;
  tenant_id: string;
  expires_at: string | Date;
  user_id?: string | null;
  rp_id?: string | null;
  expected_origin?: string | null;
} | null> {
  await ensureWebauthnRpColumns(pool);
  try {
    const ch = await pool.query(
      `SELECT challenge, tenant_id, expires_at, user_id, rp_id, expected_origin
       FROM be_webauthn_challenges
       WHERE challenge_id = $1 AND type = $2 LIMIT 1`,
      [challengeId, type],
    );
    return (ch.rows[0] as never) ?? null;
  } catch {
    const ch = await pool.query(
      `SELECT challenge, tenant_id, expires_at, user_id
       FROM be_webauthn_challenges
       WHERE challenge_id = $1 AND type = $2 LIMIT 1`,
      [challengeId, type],
    );
    return (ch.rows[0] as never) ?? null;
  }
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
  requestOrigin?: string | null;
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
  const row = await loadWebauthnChallenge(pool, input.challengeId, 'registration');
  if (!row || row.user_id !== input.userId) {
    return { status: 'ERROR', message: 'invalid challenge' };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { status: 'ERROR', message: 'challenge expired' };
  }

  const rp = await resolveWebAuthnRp({
    projectId: input.projectId,
    // Prefer values bound at options-create time (cannot be spoofed mid-flow).
    rpId: row.rp_id || input.rpId,
    expectedOrigin: row.expected_origin || input.expectedOrigin,
    requestOrigin: input.requestOrigin,
  });
  if (!rp.ok) return { status: 'ERROR', message: rp.message };
  const rpID = rp.rpId;
  const expectedOrigin = rp.expectedOrigin;

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
  expectedOrigin?: string;
  requestOrigin?: string | null;
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
  const rp = await resolveWebAuthnRp({
    projectId: input.projectId,
    rpId: input.rpId,
    expectedOrigin: input.expectedOrigin,
    requestOrigin: input.requestOrigin,
  });
  if (!rp.ok) return { status: 'ERROR', message: rp.message };
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
    rpID: rp.rpId,
    allowCredentials,
    userVerification: 'preferred',
  });

  const challengeId = `wac_${randomBytes(12).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await insertWebauthnChallenge(pool, {
    challengeId,
    tenantId,
    userId: input.userId ?? null,
    challenge: options.challenge,
    type: 'authentication',
    expiresAt: expiresAt.toISOString(),
    rpId: rp.rpId,
    expectedOrigin: rp.expectedOrigin,
  });

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
  requestOrigin?: string | null;
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
  const row = await loadWebauthnChallenge(pool, input.challengeId, 'authentication');
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
    const rp = await resolveWebAuthnRp({
      projectId: input.projectId,
      rpId: row.rp_id || input.rpId,
      expectedOrigin: row.expected_origin || input.expectedOrigin,
      requestOrigin: input.requestOrigin,
    });
    if (!rp.ok) return { status: 'ERROR', message: rp.message };
    try {
      const verification = await verifyAuthenticationResponse({
        response: input.response,
        expectedChallenge: row.challenge,
        expectedOrigin: rp.expectedOrigin,
        expectedRPID: rp.rpId,
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
