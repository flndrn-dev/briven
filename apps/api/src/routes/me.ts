import { Hono } from 'hono';
import { z } from 'zod';

import { env } from '../env.js';
import { requireAuth, type Session, type User } from '../middleware/session.js';
import { audit, hashIp } from '../services/audit.js';
import { getProfile, setAvatar, updateProfile } from '../services/me.js';

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

// Avatar lives as a data: URI in users.image — small PNG/JPEG/WEBP, client-
// side-resized before upload. Server re-validates the payload shape and the
// decoded image byte size to keep the column bounded.
const AVATAR_DATA_URI_RE = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/;
const AVATAR_MAX_DECODED_BYTES = 256 * 1024; // 256 KiB after base64-decode
const AVATAR_MAX_ENCODED_CHARS = Math.ceil(AVATAR_MAX_DECODED_BYTES * 1.4) + 64;

const avatarSchema = z.object({
  dataUri: z.string().max(AVATAR_MAX_ENCODED_CHARS),
});

meRouter.post('/v1/me/avatar', requireAuth(), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ code: 'unauthorized', message: 'authentication required' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = avatarSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
      400,
    );
  }

  const match = AVATAR_DATA_URI_RE.exec(parsed.data.dataUri);
  if (!match) {
    return c.json(
      { code: 'bad_image', message: 'dataUri must be a base64 png/jpeg/webp image' },
      400,
    );
  }
  const base64 = match[2]!;
  const decodedBytes = Math.floor((base64.length * 3) / 4);
  if (decodedBytes > AVATAR_MAX_DECODED_BYTES) {
    return c.json(
      { code: 'too_large', message: `avatar must be ≤ ${AVATAR_MAX_DECODED_BYTES} bytes` },
      413,
    );
  }

  await setAvatar(user.id, parsed.data.dataUri);
  const profile = await getProfile(user.id);
  return c.json(profile);
});

meRouter.delete('/v1/me/avatar', requireAuth(), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ code: 'unauthorized', message: 'authentication required' }, 401);
  await setAvatar(user.id, null);
  const profile = await getProfile(user.id);
  return c.json(profile);
});
