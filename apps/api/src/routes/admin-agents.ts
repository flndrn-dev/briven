import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { requireAdmin } from '../middleware/admin.js';
import { requireAuth } from '../middleware/session.js';
import { requireRecentMfa } from '../middleware/step-up.js';
import type { AppEnv } from '../types/app-env.js';
import { platformAgentScope } from '../db/schema.js';
import { audit, hashIp } from '../services/audit.js';
import {
  createPlatformAgent,
  deletePlatformAgent,
  listPlatformAgents,
  testPlatformAgent,
  updatePlatformAgent,
} from '../services/platform-agents.js';

/**
 * Admin AI-agent manager — /v1/admin/agents. The write surface behind the
 * cockpit's "AI Agents" page: register named agents (provider + endpoint +
 * model + scope), rotate their encrypted provider keys, flip them on/off,
 * and ping their endpoints. Split out of routes/admin.ts the same way
 * admin-manifest.ts is, to keep that file from growing without bound.
 *
 * Guard chain mirrors admin.ts EXACTLY: session → admin bit → step-up
 * freshness on every mutation (reads pass so the page renders without
 * re-prompting). The api key is accepted as input, encrypted at rest via
 * services/platform-agents.ts, and NEVER returned or logged — audit rows
 * record only that a key was set/rotated, never its value.
 */

function ipHash(c: Context<AppEnv>): string | null {
  const fwd = c.req.raw.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0]!.trim() : null;
  return hashIp(ip);
}

export const adminAgentsRouter = new Hono<AppEnv>();

for (const path of ['/v1/admin/agents', '/v1/admin/agents/*'] as const) {
  adminAgentsRouter.use(path, requireAuth());
  adminAgentsRouter.use(path, requireAdmin());
}
// Every agent MUTATION requires fresh step-up auth per CLAUDE.md §5.4 —
// same method-gated pattern as routes/admin.ts.
const mfa = requireRecentMfa(10);
for (const path of ['/v1/admin/agents', '/v1/admin/agents/*'] as const) {
  adminAgentsRouter.use(path, async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }
    return mfa(c, next);
  });
}

/* ─── validation ─────────────────────────────────────────────────────── */

const scopeSchema = z.enum(platformAgentScope);
// Min 12 keeps the masked prefix(4)+suffix(4) hint from ever revealing a
// whole key; max 4096 bounds the ciphertext column.
const apiKeySchema = z.string().min(12).max(4096);
const endpointSchema = z.string().url().max(2000);

const createAgentSchema = z.object({
  name: z.string().min(1).max(120),
  provider: z.string().min(1).max(40),
  endpoint: endpointSchema.optional(),
  apiKey: apiKeySchema.optional(),
  model: z.string().min(1).max(120),
  scope: scopeSchema,
  enabled: z.boolean().optional(),
});

const updateAgentSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    provider: z.string().min(1).max(40).optional(),
    // Nullable so an admin can clear a stale endpoint back to the provider
    // default without deleting the agent.
    endpoint: endpointSchema.nullable().optional(),
    apiKey: apiKeySchema.optional(),
    model: z.string().min(1).max(120).optional(),
    scope: scopeSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });

/* ─── routes ─────────────────────────────────────────────────────────── */

adminAgentsRouter.get('/v1/admin/agents', async (c) => {
  const agents = await listPlatformAgents();
  return c.json({ agents });
});

adminAgentsRouter.post('/v1/admin/agents', async (c) => {
  const actor = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = createAgentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const agent = await createPlatformAgent(parsed.data, actor.id);
  await audit({
    actorId: actor.id,
    projectId: null,
    action: 'admin.agent.create',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    // Never the key — only whether one was supplied.
    metadata: {
      agentId: agent.id,
      name: agent.name,
      provider: agent.provider,
      scope: agent.scope,
      keySet: agent.hasKey,
    },
  });
  return c.json({ agent }, 201);
});

adminAgentsRouter.patch('/v1/admin/agents/:id', async (c) => {
  const actor = c.get('user')!;
  const agentId = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = updateAgentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const { apiKey, ...rest } = parsed.data;
  const agent = await updatePlatformAgent(agentId, parsed.data);
  await audit({
    actorId: actor.id,
    projectId: null,
    action: 'admin.agent.update',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: {
      agentId,
      fields: Object.keys(rest),
      keyRotated: apiKey !== undefined,
    },
  });
  return c.json({ agent });
});

/**
 * Server-side connectivity ping — decrypts the key in memory, GETs the
 * agent's endpoint (or the provider's well-known models url), and reports
 * ok / rejected / unreachable. POST (not GET) because it spends real
 * network I/O against a third party, so it belongs behind the step-up gate.
 */
adminAgentsRouter.post('/v1/admin/agents/:id/test', async (c) => {
  const actor = c.get('user')!;
  const agentId = c.req.param('id');
  const result = await testPlatformAgent(agentId);
  await audit({
    actorId: actor.id,
    projectId: null,
    action: 'admin.agent.test',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { agentId, ok: result.ok, status: result.status },
  });
  return c.json({ agentId, ...result });
});

adminAgentsRouter.delete('/v1/admin/agents/:id', async (c) => {
  const actor = c.get('user')!;
  const agentId = c.req.param('id');
  await deletePlatformAgent(agentId);
  await audit({
    actorId: actor.id,
    projectId: null,
    action: 'admin.agent.delete',
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { agentId },
  });
  return c.json({ ok: true });
});
