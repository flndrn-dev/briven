import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

import { env } from '../env.js';

const ISSUER = 'briven-api';
const AUDIENCE = 'briven-cli';
const TTL_SECONDS = 60 * 60 * 24;

export interface CliTokenPayload extends JWTPayload {
  sub: string;
  scope: 'cli';
}

function secretBytes(): Uint8Array {
  // Fail closed (sprint S2.8): if the secret is unset, encoding `undefined`
  // would yield a CONSTANT key — anyone could forge a CLI token. Refuse to
  // sign or verify rather than fall back to a guessable key.
  const secret = env.BRIVEN_BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      'BRIVEN_BETTER_AUTH_SECRET is not set — refusing to sign/verify CLI tokens with an empty key',
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signCliToken(userId: string): Promise<string> {
  return new SignJWT({ scope: 'cli' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secretBytes());
}

export async function verifyCliToken(token: string): Promise<CliTokenPayload> {
  const { payload } = await jwtVerify(token, secretBytes(), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (payload.scope !== 'cli') {
    throw new Error('cli-jwt: wrong scope');
  }
  // Platform users (Better Auth) use opaque nanoid ids, not u_… engine ids.
  // The users-table lookup in requireAuth is the real existence check.
  // Reject empty / absurd subjects only (flndrn 2026-07-29: invalid cli token
  // after successful Allow because sub was WUKq… without a u_ prefix).
  if (
    typeof payload.sub !== 'string' ||
    payload.sub.length < 8 ||
    payload.sub.length > 128
  ) {
    throw new Error('cli-jwt: missing or invalid subject');
  }
  return payload as CliTokenPayload;
}
