/**
 * Sign-in tokens — single-use JWTs for programmatic session creation.
 *
 * Admin/backend creates a token for a user. The token is a short-lived JWT
 * (1 hour default) that can be exchanged exactly once for a real session.
 * Typical use cases: support impersonation, email-less magic links, or
 * backend-initiated sign-in flows.
 *
 * Security: the JWT carries the user id in `sub` and a unique `jti`. The
 * jti is stored in `_briven_auth_signin_tokens` and marked `used_at` on
 * exchange. Replaying a used token returns 410 Gone.
 */

import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

import { env } from '../env.js';
import { runInProjectDatabase } from '../db/data-plane.js';
import { log } from '../lib/logger.js';

const ISSUER = 'briven-auth';
const AUDIENCE = 'briven-auth-signin';
const DEFAULT_TTL_MINUTES = 60;

function secretBytes(): Uint8Array {
  const secret = env.BRIVEN_BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      'BRIVEN_BETTER_AUTH_SECRET is not set — refusing to sign/verify sign-in tokens with an empty key',
    );
  }
  return new TextEncoder().encode(secret);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface SigninTokenPayload extends JWTPayload {
  sub: string;
  scope: 'signin-token';
  jti: string;
}

export interface CreatedSigninToken {
  token: string;
  expiresAt: Date;
}

/**
 * Create a single-use sign-in token for a user. Returns the plaintext JWT
 * exactly once — the caller is responsible for delivering it securely.
 */
export async function createSigninToken(
  projectId: string,
  userId: string,
  opts: { ttlMinutes?: number } = {},
): Promise<CreatedSigninToken> {
  const ttlMinutes = opts.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  const jti = randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  const token = await new SignJWT({ scope: 'signin-token', jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlMinutes}m`)
    .sign(secretBytes());

  const tokenHash = hashToken(token);

  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `INSERT INTO "_briven_auth_signin_tokens" (id, user_id, token_hash, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())`,
      [jti, userId, tokenHash, expiresAt.toISOString()] as never,
    );
  });

  return { token, expiresAt };
}

/**
 * Exchange a sign-in token for a session. Verifies the JWT, checks it has
 * not been used, marks it used, and creates a session row.
 *
 * Returns the session token to be set as a cookie by the caller.
 */
export async function exchangeSigninToken(
  projectId: string,
  token: string,
  opts: { userAgent?: string | null } = {},
): Promise<{ sessionToken: string; expiresAt: Date }> {
  let payload: SigninTokenPayload;
  try {
    const verified = await jwtVerify(token, secretBytes(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    payload = verified.payload as SigninTokenPayload;
  } catch (err) {
    log.warn('briven_auth_signin_token_verify_failed', {
      projectId,
      message: err instanceof Error ? err.message : String(err),
    });
    throw new SigninTokenError('invalid_or_expired_token', 'token is invalid or expired');
  }

  if (payload.scope !== 'signin-token') {
    throw new SigninTokenError('invalid_or_expired_token', 'token scope mismatch');
  }

  const tokenHash = hashToken(token);
  const userId = payload.sub;
  const jti = payload.jti;

  const result = await runInProjectDatabase<{ sessionToken: string; expiresAt: Date }>(
    projectId,
    async (tx) => {
    const rows = await tx.unsafe(
      `SELECT id, user_id, used_at
       FROM "_briven_auth_signin_tokens"
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash] as never,
    ) as Array<{ id: string; user_id: string; used_at: Date | null }>;

    const row = rows[0];
    if (!row) {
      throw new SigninTokenError('invalid_or_expired_token', 'token not found');
    }
    if (row.used_at) {
      throw new SigninTokenError('token_already_used', 'token has already been used');
    }
    if (row.user_id !== userId) {
      throw new SigninTokenError('invalid_or_expired_token', 'token user mismatch');
    }

    // Mark as used.
    await tx.unsafe(
      `UPDATE "_briven_auth_signin_tokens"
       SET used_at = now(), updated_at = now()
       WHERE id = $1`,
      [jti] as never,
    );

    // Create a session. Generate a random session token and insert into
    // Better Auth's session table so the rest of the auth stack recognizes it.
    const sessionToken = randomBytes(32).toString('hex');
    const sessionExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days

    await tx.unsafe(
      `INSERT INTO "_briven_auth_sessions" (id, user_id, token, expires_at, user_agent, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())`,
      [randomBytes(16).toString('hex'), userId, sessionToken, sessionExpiresAt.toISOString(), opts.userAgent ?? null] as never,
    );

    return { sessionToken, expiresAt: sessionExpiresAt };
  });

  return result;
}

export class SigninTokenError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SigninTokenError';
  }
}
