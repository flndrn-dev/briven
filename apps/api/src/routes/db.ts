import { Hono, type Context } from 'hono';

import { rateLimit } from '../middleware/rate-limit.js';
import { requireProjectAuth } from '../middleware/project-auth.js';
import type { Session, User } from '../middleware/session.js';
import { audit, hashIp } from '../services/audit.js';
import { issueShellToken } from '../services/db-shell.js';

type AppEnv = {
  Variables: {
    user: User | null;
    session: Session | null;
    apiKeyId: string | null;
    requestId: string;
  };
};

function ipHash(c: Context<AppEnv>): string | null {
  const fwd = c.req.raw.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0]!.trim() : null;
  return hashIp(ip);
}

export const dbRouter = new Hono<AppEnv>();

dbRouter.use('/v1/projects/:id/db/*', requireProjectAuth());

// why: 5/min per project is enough for a human-driven `briven db shell`
// loop and restrictive enough that a leaked api key can't silently
// harvest fresh DSNs.
dbRouter.post(
  '/v1/projects/:id/db/shell-token',
  rateLimit({
    scope: 'db-shell-token',
    limit: 5,
    windowMs: 60_000,
    key: (c) => c.req.param('id') ?? null,
  }),
  async (c) => {
    const projectId = c.req.param('id');
    const user = c.get('user');
    const apiKeyId = c.get('apiKeyId');

    const { dsn, role, expiresAt } = await issueShellToken(projectId);

    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'db.shell_token',
      ipHash: ipHash(c),
      userAgent: c.req.header('user-agent') ?? null,
      // why: record expiry only; DSN + password are never audit-logged.
      metadata: { expiresAt: expiresAt.toISOString(), via: apiKeyId ? 'api_key' : 'session' },
    });

    return c.json({ dsn, role, expiresAt: expiresAt.toISOString() });
  },
);
