import { ForbiddenError, UnauthorizedError } from '@briven/shared';
import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';

import { getDb } from '../db/client.js';
import { users } from '../db/schema.js';
import type { User } from './session.js';

/**
 * Require that the authenticated user has `isAdmin = true`. Mount on every
 * /v1/admin/* route.
 *
 * Note: step-up auth (2FA/password re-entry within last 10 min) is
 * enforced by `requireFreshAuth` in a separate middleware — this one only
 * verifies the admin bit.
 */
export const requireAdmin = (): MiddlewareHandler => async (c, next) => {
  const user = c.get('user') as User | null;
  if (!user) throw new UnauthorizedError();

  const db = getDb();
  const [row] = await db
    .select({ isAdmin: users.isAdmin, suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!row?.isAdmin) throw new ForbiddenError('admin only');
  if (row.suspendedAt) throw new ForbiddenError('account suspended');

  await next();
};
