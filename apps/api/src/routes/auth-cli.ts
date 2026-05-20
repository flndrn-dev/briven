import { Hono } from 'hono';

import { signCliToken } from '../lib/cli-jwt.js';
import { userRateLimit } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/session.js';
import { audit, hashIp } from '../services/audit.js';
import type { AppEnv } from '../types/app-env.js';

/**
 * POST /v1/auth/cli-token — mints a short-lived JWT bound to the calling
 * user that the briven CLI can carry in a `Bearer` header on subsequent
 * requests. The route accepts either a dashboard session cookie or an
 * existing CLI bearer (requireAuth() handles both), so the CLI can refresh
 * its own token without a round-trip through the browser.
 *
 * Token semantics live in src/lib/cli-jwt.ts (24h TTL, scope=cli,
 * issuer=briven-api, audience=briven-cli). Every mint is audited under the
 * `cli.token.mint` action so an operator can spot unusual issuance patterns.
 */
export const authCliRouter = new Hono<AppEnv>();

// Cap mints at 5 per user per 60s window (RATE_LIMIT_WINDOW_MS in
// services/tiers.ts). A legitimate CLI refresh is a once-a-day event; a
// burst above 5 is either a script bug or token-grinding worth slowing.
authCliRouter.post(
  '/v1/auth/cli-token',
  requireAuth(),
  userRateLimit('cli.token.mint', 5),
  async (c) => {
    const user = c.get('user');
    if (!user) {
      return c.json({ code: 'unauthorized', message: 'authentication required' }, 401);
    }
    const token = await signCliToken(user.id);
    await audit({
      actorId: user.id,
      projectId: null,
      action: 'cli.token.mint',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { ttlSeconds: 60 * 60 * 24 },
    });
    return c.json({ token });
  },
);
