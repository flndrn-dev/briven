/**
 * MFA second-factor challenge (SuperTokens-style factor progression).
 *
 * After password OK, issue a short-lived signed ticket. /totp/verify must
 * present that ticket — bare userId + TOTP is not enough.
 */

import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { env } from '../../env.js';
import { getRedis } from '../../lib/redis.js';

const TTL_MS = 5 * 60 * 1000;
const USED_PREFIX = 'mfa:chal:used:';

function signingSecret(): string {
  return (
    env.BRIVEN_JWT_SIGNING_KEY ||
    env.BRIVEN_BETTER_AUTH_SECRET ||
    env.BRIVEN_ENCRYPTION_KEY ||
    // Dev-only fallback — production always has one of the above.
    'briven-dev-mfa-challenge-secret-min-32-chars!!'
  );
}

function sign(payload: string): string {
  return createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

/**
 * Issue a one-shot MFA challenge after first factor succeeds.
 * Returns opaque base64url token for the client.
 */
export function issueMfaChallenge(input: {
  userId: string;
  tenantId: string;
}): string {
  const exp = Date.now() + TTL_MS;
  const nonce = randomBytes(16).toString('hex');
  const payload = `${input.userId}|${input.tenantId}|${exp}|${nonce}`;
  const sig = sign(payload);
  return Buffer.from(`${payload}|${sig}`, 'utf8').toString('base64url');
}

export type MfaChallengeOk = {
  ok: true;
  userId: string;
  tenantId: string;
  nonce: string;
};

export type MfaChallengeFail = { ok: false; message: string };

/**
 * Verify challenge structure + signature + expiry (does not consume single-use yet).
 */
export function parseMfaChallenge(
  token: string | undefined | null,
): MfaChallengeOk | MfaChallengeFail {
  if (!token || typeof token !== 'string' || token.length < 16) {
    return { ok: false, message: 'mfaChallenge required' };
  }
  let raw: string;
  try {
    raw = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return { ok: false, message: 'invalid mfaChallenge' };
  }
  const parts = raw.split('|');
  if (parts.length !== 5) {
    return { ok: false, message: 'invalid mfaChallenge' };
  }
  const [userId, tenantId, expStr, nonce, sig] = parts;
  if (!userId || !tenantId || !expStr || !nonce || !sig) {
    return { ok: false, message: 'invalid mfaChallenge' };
  }
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) {
    return { ok: false, message: 'mfaChallenge expired — sign in again' };
  }
  const payload = `${userId}|${tenantId}|${expStr}|${nonce}`;
  const expected = sign(payload);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, message: 'invalid mfaChallenge' };
    }
  } catch {
    return { ok: false, message: 'invalid mfaChallenge' };
  }
  return { ok: true, userId, tenantId, nonce };
}

/**
 * Mark challenge as used (single-use). Best-effort Redis; if Redis is down,
 * still accept once (signature + short TTL remain).
 */
export async function consumeMfaChallenge(
  token: string,
  expectedUserId: string,
): Promise<MfaChallengeOk | MfaChallengeFail> {
  const parsed = parseMfaChallenge(token);
  if (!parsed.ok) return parsed;
  if (parsed.userId !== expectedUserId) {
    return { ok: false, message: 'mfaChallenge does not match user' };
  }
  const redis = getRedis();
  if (redis) {
    try {
      const key = `${USED_PREFIX}${parsed.nonce}`;
      const set = await redis.set(key, '1', 'PX', TTL_MS, 'NX');
      if (set !== 'OK') {
        return { ok: false, message: 'mfaChallenge already used' };
      }
    } catch {
      /* fail open on redis errors for availability; TTL still bounds abuse */
    }
  }
  return parsed;
}

export const MFA_CHALLENGE_TTL_MS = TTL_MS;
