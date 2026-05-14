import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { users } from '../db/schema.js';

import type { User } from './session.js';

/**
 * Step-up authentication gate. Requires the caller's session-bound user
 * to have a recent `last_mfa_at` attestation, set by
 * `POST /v1/auth/step-up` after a successful password re-prompt.
 *
 * Per CLAUDE.md §5.4 admin actions need 2FA within the last 10 minutes.
 * Real TOTP/WebAuthn is a Phase 3 follow-up; v1 enforces *recency* via a
 * password re-prompt — same shape, weaker primitive.
 *
 * Returns 403 `step_up_required` when the attestation is missing or
 * older than `maxAgeMs`. The dashboard catches that and surfaces a
 * step-up prompt; on success the original request can be retried.
 */
export function requireRecentMfa(maxAgeMin = 10): MiddlewareHandler {
  const maxAgeMs = maxAgeMin * 60 * 1000;
  return async (c, next) => {
    const user = c.get('user') as User | null;
    if (!user) {
      return c.json({ code: 'unauthorized', message: 'authentication required' }, 401);
    }
    // Re-read the user row so we see the freshest last_mfa_at. The
    // session-attached user may be cached and stale by the cookie's TTL.
    const db = getDb();
    const rows = await db
      .select({ lastMfaAt: users.lastMfaAt })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const lastMfaAt = rows[0]?.lastMfaAt ?? null;
    const fresh = lastMfaAt && Date.now() - lastMfaAt.getTime() <= maxAgeMs;
    if (!fresh) {
      return c.json(
        {
          code: 'step_up_required',
          message: `this action requires step-up auth within the last ${maxAgeMin} minutes`,
          maxAgeMin,
        },
        403,
      );
    }
    await next();
    return;
  };
}
