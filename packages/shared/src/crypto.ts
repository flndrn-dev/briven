import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time equality check for shared secrets and HMAC outputs.
 *
 * Why: comparing tokens with `===` runs in time proportional to the shared
 * prefix length, which leaks byte-by-byte info to a remote attacker who
 * can measure response latency. `timingSafeEqual` runs in time
 * proportional to length only, regardless of content.
 *
 * Length-mismatch is checked up front and bails fast — for fixed-length
 * secrets (the runtime shared secret is `>= 32` chars, HMAC outputs are
 * fixed by digest size) the length itself is not the secret. For
 * variable-length inputs you control, pad both sides to the same length
 * before calling.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
