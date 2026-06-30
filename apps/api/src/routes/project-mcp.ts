import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';

import { NotFoundError } from '@briven/shared';

import { requireProjectAuth, requireProjectRole } from '../middleware/project-auth.js';
import { projectRateLimit } from '../middleware/rate-limit.js';
import { hashIp } from '../services/audit.js';
import { mcpKeyScope, type ProjectTier } from '../db/schema.js';
import {
  defaultMcpAccessDeps,
  defaultMcpVerifyDeps,
  deleteRevokedKey,
  disableForProject,
  enableForProject,
  getGlobalEnabled,
  isPlanEligibleForMcp,
  issueKey,
  listKeysForProject,
  McpKeyNotRevokedError,
  McpPlanRequiredError,
  revokeKey,
  type MaskedMcpKey,
  type McpAccessDeps,
  type McpActor,
} from '../services/mcp-access.js';
import type { ProjectAppEnv as AppEnv } from '../types/app-env.js';

/**
 * USER-scoped per-project MCP / Agent-Access surface.
 *
 * Same capability as the super-admin cockpit (`/v1/admin/mcp*`) — turn MCP on/
 * off and issue/revoke `pk_briven_mcp_` keys — but PROJECT-scoped and reachable
 * by the project's OWN admin, so a paying Pro/Team customer self-activates it
 * without any platform-admin involvement. Every route is gated by
 * `requireProjectAuth()` + `requireProjectRole('admin')`.
 *
 * The platform-wide GLOBAL kill-switch stays admin-only and is NOT exposed here
 * — users only ever see its effect: when it's off, enabling/issuing is refused
 * (defence-in-depth) and the UI shows MCP as unavailable.
 *
 * Gating model (enforced SERVER-SIDE, so the UI hiding a button is never the
 * gate):
 *   - enable    → 403 `mcp_global_disabled` if the global switch is off;
 *                 403 `mcp_plan_required`   if the project isn't Pro/Team.
 *   - disable   → always allowed (no gate).
 *   - issue key → same as enable, plus 409 `mcp_not_enabled` if MCP isn't on
 *                 for the project yet.
 *   - revoke    → 404 if the key is unknown; 403 `cross_project` if the key
 *                 belongs to a DIFFERENT project than the URL `:id`
 *                 (no cross-project revoke).
 *   - delete    → same cross-project guard as revoke, plus REVOKE-THEN-DELETE:
 *                 409 `mcp_key_not_revoked` if the key is still active (a live
 *                 key must be revoked before it can be deleted).
 * Every mutation is audited inside the mcp-access service (`mcp.*` actions,
 * actor = the acting user id, project = `:id`).
 */

/** Read-side dependencies not already covered by `McpAccessDeps`. Injectable so the router is unit-testable without a DB. */
export interface ProjectMcpReadDeps {
  getGlobalEnabled(): Promise<boolean>;
  isProjectEnabled(projectId: string): Promise<boolean>;
  listKeysForProject(projectId: string): Promise<MaskedMcpKey[]>;
}

const defaultReadDeps: ProjectMcpReadDeps = {
  getGlobalEnabled,
  isProjectEnabled: (projectId) => defaultMcpVerifyDeps.isProjectEnabled(projectId),
  listKeysForProject,
};

function ipHash(c: Context<AppEnv>): string | null {
  const fwd = c.req.raw.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0]!.trim() : null;
  return hashIp(ip);
}

/** Build the audit actor from the request — acting user id + hashed IP + UA. */
function mcpActor(c: Context<AppEnv>): McpActor {
  const user = c.get('user');
  return {
    id: user?.id ?? null,
    ipHash: ipHash(c),
    userAgent: c.req.header('user-agent') ?? null,
  };
}

const issueBody = z.object({
  name: z.string().min(1).max(120),
  scope: z.enum(mcpKeyScope),
});

function planRequired(c: Context<AppEnv>, err: McpPlanRequiredError) {
  return c.json(
    { code: err.code, message: 'Agent Access requires a Pro or Team plan', tier: err.tier },
    403,
  );
}

/**
 * Build the per-project MCP router. The auth middleware and the service deps
 * are injectable so the route logic (gating + cross-project isolation) can be
 * exercised in tests without a live DB; production uses the real middleware
 * chain + DB-backed deps.
 */
export function buildProjectMcpRouter(opts?: {
  middleware?: MiddlewareHandler[];
  accessDeps?: McpAccessDeps;
  readDeps?: ProjectMcpReadDeps;
}): Hono<AppEnv> {
  const accessDeps = opts?.accessDeps ?? defaultMcpAccessDeps;
  const read = opts?.readDeps ?? defaultReadDeps;
  const middleware = opts?.middleware ?? [requireProjectAuth(), requireProjectRole('admin')];

  const router = new Hono<AppEnv>();

  // Project-admin only. API keys minted at admin pass by design (a project key
  // already has equivalent authority over its own project).
  router.use('/v1/projects/:id/mcp', ...middleware);
  router.use('/v1/projects/:id/mcp/*', ...middleware);

  /** Status for THIS project only: global flag, plan, eligibility, on/off, keys. */
  router.get('/v1/projects/:id/mcp', async (c) => {
    const projectId = c.req.param('id');
    const [globalEnabled, tier, mcpEnabled, keys] = await Promise.all([
      read.getGlobalEnabled(),
      accessDeps.getProjectPlanTier(projectId),
      read.isProjectEnabled(projectId),
      read.listKeysForProject(projectId),
    ]);
    const planTier: ProjectTier = tier ?? 'free';
    return c.json({
      globalEnabled,
      planTier,
      eligible: isPlanEligibleForMcp(planTier),
      mcpEnabled,
      keys,
    });
  });

  /** Enable MCP for the project. Gates: global ON + Pro/Team plan. */
  router.post('/v1/projects/:id/mcp/enable', projectRateLimit('mutate'), async (c) => {
    const projectId = c.req.param('id');
    if (!(await read.getGlobalEnabled())) {
      return c.json(
        { code: 'mcp_global_disabled', message: 'Agent access is currently disabled platform-wide' },
        403,
      );
    }
    try {
      const result = await enableForProject(projectId, mcpActor(c), accessDeps);
      return c.json(result);
    } catch (err) {
      if (err instanceof McpPlanRequiredError) return planRequired(c, err);
      throw err;
    }
  });

  /** Disable MCP for the project (always allowed — no plan gate). */
  router.post('/v1/projects/:id/mcp/disable', projectRateLimit('mutate'), async (c) => {
    const projectId = c.req.param('id');
    const result = await disableForProject(projectId, mcpActor(c), accessDeps);
    return c.json(result);
  });

  /** Issue a key — returns the FULL plaintext EXACTLY once. Same gates as enable + project must be enabled. */
  router.post('/v1/projects/:id/mcp/keys', projectRateLimit('mutate'), async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    const parsed = issueBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
    }
    if (!(await read.getGlobalEnabled())) {
      return c.json(
        { code: 'mcp_global_disabled', message: 'Agent access is currently disabled platform-wide' },
        403,
      );
    }
    if (!(await read.isProjectEnabled(projectId))) {
      return c.json(
        { code: 'mcp_not_enabled', message: 'enable Agent Access for this project first' },
        409,
      );
    }
    try {
      const result = await issueKey(
        { projectId, name: parsed.data.name, scope: parsed.data.scope },
        mcpActor(c),
        accessDeps,
      );
      return c.json(result, 201);
    } catch (err) {
      if (err instanceof McpPlanRequiredError) return planRequired(c, err);
      throw err;
    }
  });

  /** Revoke a key — refuses any key that belongs to a DIFFERENT project (no cross-project revoke). */
  router.post('/v1/projects/:id/mcp/keys/:keyId/revoke', projectRateLimit('mutate'), async (c) => {
    const projectId = c.req.param('id');
    const keyId = c.req.param('keyId');
    const row = await accessDeps.getKeyById(keyId);
    if (!row) return c.json({ code: 'not_found', message: 'key not found' }, 404);
    if (row.projectId !== projectId) {
      return c.json(
        { code: 'cross_project', message: 'key does not belong to this project' },
        403,
      );
    }
    try {
      const result = await revokeKey(keyId, mcpActor(c), accessDeps);
      return c.json(result);
    } catch (err) {
      if (err instanceof NotFoundError) return c.json({ code: 'not_found' }, 404);
      throw err;
    }
  });

  /**
   * Delete a key — same cross-project guard as revoke, plus REVOKE-THEN-DELETE:
   * only an already-revoked key may be removed (409 `mcp_key_not_revoked` for an
   * active key). Unknown / other-project → 404 / 403 `cross_project`.
   */
  router.post('/v1/projects/:id/mcp/keys/:keyId/delete', projectRateLimit('mutate'), async (c) => {
    const projectId = c.req.param('id');
    const keyId = c.req.param('keyId');
    const row = await accessDeps.getKeyById(keyId);
    if (!row) return c.json({ code: 'not_found', message: 'key not found' }, 404);
    if (row.projectId !== projectId) {
      return c.json(
        { code: 'cross_project', message: 'key does not belong to this project' },
        403,
      );
    }
    try {
      const result = await deleteRevokedKey(keyId, mcpActor(c), accessDeps);
      return c.json(result);
    } catch (err) {
      if (err instanceof McpKeyNotRevokedError) {
        return c.json({ code: err.code, message: 'revoke this key before deleting it' }, 409);
      }
      if (err instanceof NotFoundError) return c.json({ code: 'not_found' }, 404);
      throw err;
    }
  });

  return router;
}

/** The production instance — real middleware + DB-backed deps. */
export const projectMcpRouter = buildProjectMcpRouter();
