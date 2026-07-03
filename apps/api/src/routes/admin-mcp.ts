import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { requireAdmin } from '../middleware/admin.js';
import { requireAuth } from '../middleware/session.js';
import { requireRecentMfa } from '../middleware/step-up.js';
import type { AppEnv } from '../types/app-env.js';
import { hashIp } from '../services/audit.js';
import {
  deleteRevokedKey as mcpDeleteRevokedKey,
  disableForProject as mcpDisableForProject,
  enableForProject as mcpEnableForProject,
  getGlobalEnabled as mcpGetGlobalEnabled,
  issueKey as mcpIssueKey,
  listMcpAudit,
  listProjectAccess as mcpListProjectAccess,
  McpKeyNotRevokedError,
  McpPlanRequiredError,
  revokeKey as mcpRevokeKey,
  setGlobalEnabled as mcpSetGlobalEnabled,
  type McpActor,
} from '../services/mcp-access.js';
import { mcpKeyScope } from '../db/schema.js';
import { NotFoundError } from '@briven/shared';

/**
 * Admin MCP access control — restored from commits 6f2e4ad + 2388ab6 after a
 * merge amputated the inline block from routes/admin.ts. The realtime socket
 * server that consumes these keys is a separate track. Every mutation is
 * step-up-gated (the method-gated middleware below) and audited via the service
 * with the `mcp.*` action namespace. The plan gate is SERVER-SIDE: enabling /
 * issuing for a non-paying project returns 403 mcp_plan_required.
 *
 * Response shapes are a contract with the web MCP page
 * (apps/web/(admin)/admin/mcp/mcp-key-form.tsx — MaskedKey, ProjectAccess).
 * Dates are serialized to ISO strings by Hono's c.json.
 */
export const adminMcpRouter = new Hono<AppEnv>();

for (const path of ['/v1/admin/mcp', '/v1/admin/mcp/*'] as const) {
  adminMcpRouter.use(path, requireAuth());
  adminMcpRouter.use(path, requireAdmin());
}
// Every MCP MUTATION requires fresh step-up auth per CLAUDE.md §5.4 — same
// method-gated pattern as routes/admin.ts + routes/admin-agents.ts. Reads pass
// through so the dashboard renders without re-prompting on navigation.
const mfa = requireRecentMfa(10);
for (const path of ['/v1/admin/mcp', '/v1/admin/mcp/*'] as const) {
  adminMcpRouter.use(path, async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }
    return mfa(c, next);
  });
}

/** Build the audit actor from the request — id + hashed IP + user-agent. */
function mcpActor(c: Context<AppEnv>): McpActor {
  const user = c.get('user');
  const fwd = c.req.raw.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0]!.trim() : null;
  return {
    id: user?.id ?? null,
    ipHash: hashIp(ip),
    userAgent: c.req.header('user-agent') ?? null,
  };
}

/** Status: global flag + per-project access list + recent mcp.* audit. */
adminMcpRouter.get('/v1/admin/mcp', async (c) => {
  const [globalEnabled, projects, recentAudit] = await Promise.all([
    mcpGetGlobalEnabled(),
    mcpListProjectAccess(),
    listMcpAudit(100),
  ]);
  return c.json({
    globalEnabled,
    projects,
    audit: recentAudit.map((r) => ({
      id: r.id,
      action: r.action,
      actorId: r.actorId,
      metadata: r.metadata,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

/** Flip the global MCP kill-switch. OFF cuts ALL agent access at once. */
adminMcpRouter.post('/v1/admin/mcp/global', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ enabled: z.boolean() }).safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const result = await mcpSetGlobalEnabled(parsed.data.enabled, mcpActor(c));
  return c.json(result);
});

const mcpProjectBody = z.object({ projectId: z.string().min(1) });

/** Enable MCP for a project — SERVER-SIDE plan gate (Pro/Team only). */
adminMcpRouter.post('/v1/admin/mcp/projects/enable', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = mcpProjectBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  try {
    const result = await mcpEnableForProject(parsed.data.projectId, mcpActor(c));
    return c.json(result);
  } catch (err) {
    if (err instanceof McpPlanRequiredError) {
      return c.json(
        {
          code: err.code,
          message: 'MCP access requires a Pro or Team plan',
          tier: err.tier,
        },
        403,
      );
    }
    throw err;
  }
});

/** Disable MCP for a project (no plan gate — always allowed). */
adminMcpRouter.post('/v1/admin/mcp/projects/disable', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = mcpProjectBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const result = await mcpDisableForProject(parsed.data.projectId, mcpActor(c));
  return c.json(result);
});

const mcpIssueBody = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  scope: z.enum(mcpKeyScope),
});

/** Issue a key — returns the FULL plaintext EXACTLY once. */
adminMcpRouter.post('/v1/admin/mcp/keys', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = mcpIssueBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  try {
    const result = await mcpIssueKey(
      { projectId: parsed.data.projectId, name: parsed.data.name, scope: parsed.data.scope },
      mcpActor(c),
    );
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof McpPlanRequiredError) {
      return c.json(
        {
          code: err.code,
          message: 'MCP access requires a Pro or Team plan',
          tier: err.tier,
        },
        403,
      );
    }
    throw err;
  }
});

/** Revoke a key — sets revoked_at + enabled=false. */
adminMcpRouter.post('/v1/admin/mcp/keys/revoke', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ keyId: z.string().min(1) }).safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  try {
    const result = await mcpRevokeKey(parsed.data.keyId, mcpActor(c));
    return c.json(result);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return c.json({ code: 'not_found' }, 404);
    }
    throw err;
  }
});

/** Delete an already-revoked key. 409 if the key was never revoked. */
adminMcpRouter.post('/v1/admin/mcp/keys/delete', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ keyId: z.string().min(1) }).safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  try {
    const result = await mcpDeleteRevokedKey(parsed.data.keyId, mcpActor(c));
    return c.json(result);
  } catch (err) {
    if (err instanceof McpKeyNotRevokedError) {
      return c.json({ code: err.code, message: 'revoke this key before deleting it' }, 409);
    }
    if (err instanceof NotFoundError) {
      return c.json({ code: 'not_found' }, 404);
    }
    throw err;
  }
});
