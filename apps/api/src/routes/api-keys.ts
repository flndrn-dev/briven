import { Hono } from 'hono';
import { z } from 'zod';

import { env } from '../env.js';
import { requireAuth, type Session, type User } from '../middleware/session.js';
import { audit, hashIp } from '../services/audit.js';
import {
  createApiKey,
  listApiKeysForProject,
  revokeApiKey,
} from '../services/api-keys.js';
import { getProjectForUser } from '../services/projects.js';

type AppEnv = {
  Variables: {
    user: User | null;
    session: Session | null;
    requestId: string;
  };
};

const createKeySchema = z.object({
  name: z.string().min(1).max(80),
  expiresInDays: z.number().int().positive().max(365).optional(),
});

export const apiKeysRouter = new Hono<AppEnv>();

apiKeysRouter.use('/v1/projects/:id/api-keys', requireAuth());
apiKeysRouter.use('/v1/projects/:id/api-keys/*', requireAuth());

apiKeysRouter.get('/v1/projects/:id/api-keys', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  const keys = await listApiKeysForProject(project.id);
  return c.json({ keys });
});

apiKeysRouter.post('/v1/projects/:id/api-keys', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  const body = await c.req.json().catch(() => null);
  const parsed = createKeySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        code: 'validation_failed',
        message: 'invalid request body',
        issues: parsed.error.issues,
      },
      400,
    );
  }
  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
    : undefined;
  const { record, plaintext } = await createApiKey({
    projectId: project.id,
    createdBy: user.id,
    name: parsed.data.name,
    expiresAt,
  });
  await audit({
    actorId: user.id,
    projectId: project.id,
    action: 'api_key.create',
    ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for'), env.BRIVEN_BETTER_AUTH_SECRET ?? 'dev-pepper'),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { keyId: record.id, name: record.name },
  });

  return c.json(
    {
      key: {
        id: record.id,
        name: record.name,
        suffix: record.suffix,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
      },
      // Plaintext is returned ONCE. Per CLAUDE.md §5.4 we never log or
      // store this; the caller must save it immediately.
      plaintext,
    },
    201,
  );
});

apiKeysRouter.delete('/v1/projects/:id/api-keys/:keyId', async (c) => {
  const user = c.get('user')!;
  const project = await getProjectForUser(c.req.param('id'), user.id);
  const keyId = c.req.param('keyId');
  await revokeApiKey(project.id, keyId);
  await audit({
    actorId: user.id,
    projectId: project.id,
    action: 'api_key.revoke',
    ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for'), env.BRIVEN_BETTER_AUTH_SECRET ?? 'dev-pepper'),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { keyId },
  });
  return c.json({ revoked: keyId });
});
