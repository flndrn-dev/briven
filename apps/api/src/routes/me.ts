import { Hono } from 'hono';
import { z } from 'zod';

import { env } from '../env.js';
import { requireAuth, type Session, type User } from '../middleware/session.js';
import { audit, hashIp } from '../services/audit.js';
import { getProfile, updateProfile } from '../services/me.js';

type AppEnv = {
  Variables: {
    user: User | null;
    session: Session | null;
    requestId: string;
  };
};

const patchSchema = z.object({
  name: z.string().min(1).max(200).nullable().optional(),
  legalName: z.string().min(1).max(200).nullable().optional(),
  companyName: z.string().max(200).nullable().optional(),
  vatId: z.string().max(32).nullable().optional(),
  addressLine1: z.string().max(200).nullable().optional(),
  addressLine2: z.string().max(200).nullable().optional(),
  addressCity: z.string().max(120).nullable().optional(),
  addressPostalCode: z.string().max(32).nullable().optional(),
  addressRegion: z.string().max(120).nullable().optional(),
  addressCountry: z
    .string()
    .regex(/^[A-Z]{2}$/u, 'country must be an ISO 3166-1 alpha-2 code')
    .nullable()
    .optional(),
});

export const meRouter = new Hono<AppEnv>();

meRouter.get('/v1/me', requireAuth(), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ code: 'unauthorized', message: 'authentication required' }, 401);
  const profile = await getProfile(user.id);
  return c.json(profile);
});

meRouter.patch('/v1/me', requireAuth(), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ code: 'unauthorized', message: 'authentication required' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
      400,
    );
  }

  await updateProfile(user.id, parsed.data);

  // Audit which fields changed; never log the values themselves.
  await audit({
    actorId: user.id,
    projectId: null,
    action: 'me.update',
    ipHash: hashIp(
      c.req.raw.headers.get('x-forwarded-for'),
      env.BRIVEN_BETTER_AUTH_SECRET ?? 'dev-pepper',
    ),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { fields: Object.keys(parsed.data) },
  });

  const profile = await getProfile(user.id);
  return c.json(profile);
});
