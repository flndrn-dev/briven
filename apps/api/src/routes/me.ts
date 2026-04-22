import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { getDb } from '../db/client.js';
import { users } from '../db/schema.js';
import { requireAuth, type Session, type User } from '../middleware/session.js';

type AppEnv = {
  Variables: {
    user: User | null;
    session: Session | null;
    requestId: string;
  };
};

export const meRouter = new Hono<AppEnv>();

meRouter.get('/v1/me', requireAuth(), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ code: 'unauthorized', message: 'authentication required' }, 401);

  // Pull isAdmin + suspendedAt from postgres since Better Auth's User object
  // only carries the fields it knows about (email / name / image / etc.).
  const db = getDb();
  const [row] = await db
    .select({ isAdmin: users.isAdmin, suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  return c.json({
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
    image: user.image,
    isAdmin: row?.isAdmin ?? false,
    suspendedAt: row?.suspendedAt ?? null,
  });
});
