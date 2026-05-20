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
  return new TextEncoder().encode(env.BRIVEN_BETTER_AUTH_SECRET);
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
  if (typeof payload.sub !== 'string' || !payload.sub.startsWith('u_')) {
    throw new Error('cli-jwt: missing or invalid subject');
  }
  return payload as CliTokenPayload;
}
