import { Hono } from 'hono';
import { z } from 'zod';

import { newId } from '@briven/shared';

import { requireAuth } from '../middleware/session.js';
import type { AppEnv } from '../types/app-env.js';
import { audit, hashIp } from '../services/audit.js';
import { createOrg, listOrgsForUser } from '../services/orgs.js';

/**
 * Multi-org surface — team creation + list. Personal orgs are auto-
 * created by the user.create.after Better Auth hook and never appear
 * in the "new team" form; team orgs are explicit and listed here so
 * the dashboard's /dashboard/teams can render them.
 */

export const orgsRouter = new Hono<AppEnv>();

orgsRouter.use('/v1/me/orgs', requireAuth());
orgsRouter.use('/v1/orgs', requireAuth());

/**
 * List every org the signed-in user is a member of — both the personal
 * org and any team orgs they've created or been added to. Each row
 * carries a `personal` flag so the UI can group "personal" separately
 * from team orgs.
 */
orgsRouter.get('/v1/me/orgs', async (c) => {
  const user = c.get('user')!;
  const orgs = await listOrgsForUser(user.id);
  return c.json({
    orgs: orgs.map((o) => ({
      id: o.id,
      slug: o.slug,
      name: o.name,
      personal: o.personal,
      createdAt: o.createdAt,
    })),
  });
});

const createSchema = z.object({
  name: z.string().min(2).max(200),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/u, 'slug must be kebab-case, 2-40 chars')
    .optional(),
});

/**
 * Create a new team org. The creator becomes its owner. Free tier caps
 * teams per user at 1 (one personal + one team); Pro at 5; Team at
 * unlimited — but enforcement of those caps is a follow-up. Today the
 * platform just creates the row.
 */
orgsRouter.post('/v1/orgs', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const slug =
    parsed.data.slug ??
    `${parsed.data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 32)}-${newId('org').slice(-6).toLowerCase()}`;
  const org = await createOrg({
    createdBy: user.id,
    name: parsed.data.name,
    slug,
    personal: false,
    role: 'owner',
  });
  await audit({
    actorId: user.id,
    projectId: null,
    action: 'org.created',
    ipHash: hashIp(c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { orgId: org.id, slug: org.slug, name: org.name },
  });
  return c.json({
    org: {
      id: org.id,
      slug: org.slug,
      name: org.name,
      personal: org.personal,
      createdAt: org.createdAt,
    },
  });
});
