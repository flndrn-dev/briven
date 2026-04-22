import { Hono } from 'hono';

import { requireAuth, type Session, type User } from '../middleware/session.js';

type AppEnv = {
  Variables: {
    user: User | null;
    session: Session | null;
    requestId: string;
  };
};

export const meRouter = new Hono<AppEnv>();

meRouter.get('/v1/me', requireAuth(), (c) => {
  const user = c.get('user');
  if (!user) return c.json({ code: 'unauthorized', message: 'authentication required' }, 401);

  return c.json({
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
    image: user.image,
  });
});
