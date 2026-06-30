// Route-level tests for the USER-scoped per-project MCP router.
//
// The router is built with INJECTED deps + a fake auth middleware so the
// gating + cross-project-isolation logic is exercised without a live DB.
// The one role-enforcement test wires the REAL `requireProjectRole('admin')`
// to prove the chain refuses a non-admin.

import { describe, expect, it } from 'bun:test';
import type { MiddlewareHandler } from 'hono';

import { errorHandler } from '../middleware/error.js';
import { requireProjectRole } from '../middleware/project-auth.js';
import { buildProjectMcpRouter, type ProjectMcpReadDeps } from './project-mcp.js';
import type { McpAccessDeps } from '../services/mcp-access.js';
import type { McpKey, MemberRole, NewMcpKey, ProjectTier } from '../db/schema.js';

/* ─── fakes ──────────────────────────────────────────────────────────────── */

interface FakeState {
  accessDeps: McpAccessDeps;
  readDeps: ProjectMcpReadDeps;
  enabled: Map<string, boolean>;
  keys: Map<string, McpKey>;
  revoked: string[];
}

function makeFakes(opts: {
  planByProject?: Record<string, ProjectTier | null>;
  globalOn?: boolean;
  enabledProjects?: string[];
  seedKeys?: McpKey[];
}): FakeState {
  const planByProject = opts.planByProject ?? {};
  const enabled = new Map<string, boolean>((opts.enabledProjects ?? []).map((p) => [p, true]));
  const keys = new Map<string, McpKey>((opts.seedKeys ?? []).map((k) => [k.id, k]));
  const revoked: string[] = [];

  const accessDeps: McpAccessDeps = {
    async setGlobalSetting() {},
    async getProjectPlanTier(projectId) {
      return projectId in planByProject ? planByProject[projectId]! : null;
    },
    async setProjectEnabled(projectId, on) {
      enabled.set(projectId, on);
    },
    async insertKey(row: NewMcpKey) {
      const record: McpKey = {
        id: row.id!,
        projectId: row.projectId,
        name: row.name,
        hash: row.hash,
        prefix: row.prefix,
        suffix: row.suffix,
        scope: row.scope ?? 'read',
        enabled: row.enabled ?? true,
        createdBy: row.createdBy ?? null,
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
      };
      keys.set(record.id, record);
      return record;
    },
    async getKeyById(keyId) {
      return keys.get(keyId) ?? null;
    },
    async setKeyRevoked(keyId) {
      revoked.push(keyId);
      const row = keys.get(keyId);
      if (row) keys.set(keyId, { ...row, revokedAt: new Date(), enabled: false });
    },
    async audit() {},
  };

  const readDeps: ProjectMcpReadDeps = {
    async getGlobalEnabled() {
      return opts.globalOn ?? true;
    },
    async isProjectEnabled(projectId) {
      return enabled.get(projectId) === true;
    },
    async listKeysForProject(projectId) {
      return [...keys.values()]
        .filter((k) => k.projectId === projectId)
        .map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          suffix: k.suffix,
          scope: k.scope,
          enabled: k.enabled,
          createdAt: k.createdAt,
          lastUsedAt: k.lastUsedAt,
          revokedAt: k.revokedAt,
        }));
    },
  };

  return { accessDeps, readDeps, enabled, keys, revoked };
}

/** Fake auth middleware: sets an acting user + a project role on the request. */
function fakeAuth(role: MemberRole): MiddlewareHandler {
  return async (c, next) => {
    c.set('user', { id: 'usr_admin', email: 'a@b.c', name: 'A' } as never);
    c.set('apiKeyId', null);
    c.set('projectRole', role);
    await next();
  };
}

// Build the router AND attach the production error handler, so thrown domain
// errors (e.g. ForbiddenError from requireProjectRole) map to their HTTP codes
// exactly as they do under the real app's `app.onError(errorHandler)`.
function mountApp(opts: Parameters<typeof buildProjectMcpRouter>[0]) {
  const app = buildProjectMcpRouter(opts);
  app.onError(errorHandler);
  return app;
}

// projectRateLimit() rejects direct (proxy-less) requests outside development
// with 403 origin_direct_rejected before the handler runs. A forwarded-for
// header satisfies that guard; with no Redis in the unit env the limiter then
// fails open and the real handler runs.
const POST = { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.7' } } as const;

function makeKey(id: string, projectId: string): McpKey {
  return {
    id,
    projectId,
    name: 'agent',
    hash: 'h'.repeat(64),
    prefix: 'pk_briven_mcp_',
    suffix: 'abcd',
    scope: 'read',
    enabled: true,
    createdBy: 'usr_admin',
    createdAt: new Date(),
    lastUsedAt: null,
    revokedAt: null,
  };
}

/* ─── 1. plan gate ─────────────────────────────────────────────────────────── */

describe('plan gate (enable)', () => {
  it('free project → 403 mcp_plan_required', async () => {
    const fakes = makeFakes({ planByProject: { proj_free: 'free' }, globalOn: true });
    const app = mountApp({
      middleware: [fakeAuth('admin')],
      accessDeps: fakes.accessDeps,
      readDeps: fakes.readDeps,
    });
    const res = await app.request('/v1/projects/proj_free/mcp/enable', POST);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('mcp_plan_required');
    // gate fired before any state change
    expect(fakes.enabled.has('proj_free')).toBe(false);
  });

  it('team project → enables OK', async () => {
    const fakes = makeFakes({ planByProject: { proj_team: 'team' }, globalOn: true });
    const app = mountApp({
      middleware: [fakeAuth('admin')],
      accessDeps: fakes.accessDeps,
      readDeps: fakes.readDeps,
    });
    const res = await app.request('/v1/projects/proj_team/mcp/enable', POST);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled?: boolean };
    expect(body.enabled).toBe(true);
    expect(fakes.enabled.get('proj_team')).toBe(true);
  });

  it('global off → 403 mcp_global_disabled even for a team project', async () => {
    const fakes = makeFakes({ planByProject: { proj_team: 'team' }, globalOn: false });
    const app = mountApp({
      middleware: [fakeAuth('admin')],
      accessDeps: fakes.accessDeps,
      readDeps: fakes.readDeps,
    });
    const res = await app.request('/v1/projects/proj_team/mcp/enable', POST);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('mcp_global_disabled');
  });
});

/* ─── 2. project-role enforcement (REAL requireProjectRole) ─────────────────── */

describe('project-role enforcement', () => {
  it('a non-admin (viewer) is refused by requireProjectRole(admin)', async () => {
    const fakes = makeFakes({ planByProject: { proj_team: 'team' }, globalOn: true });
    const app = mountApp({
      // fakeAuth sets the role; the REAL requireProjectRole('admin') gates it.
      middleware: [fakeAuth('viewer'), requireProjectRole('admin')],
      accessDeps: fakes.accessDeps,
      readDeps: fakes.readDeps,
    });
    const res = await app.request('/v1/projects/proj_team/mcp/enable', POST);
    expect(res.status).toBe(403);
    expect(fakes.enabled.has('proj_team')).toBe(false);
  });

  it('an admin passes the same chain', async () => {
    const fakes = makeFakes({ planByProject: { proj_team: 'team' }, globalOn: true });
    const app = mountApp({
      middleware: [fakeAuth('admin'), requireProjectRole('admin')],
      accessDeps: fakes.accessDeps,
      readDeps: fakes.readDeps,
    });
    const res = await app.request('/v1/projects/proj_team/mcp/enable', POST);
    expect(res.status).toBe(200);
  });
});

/* ─── 3. cross-project key-revoke isolation ─────────────────────────────────── */

describe('cross-project key-revoke isolation', () => {
  it('a key from project B cannot be revoked via project A’s URL → 403 cross_project', async () => {
    const keyB = makeKey('mck_b', 'proj_B');
    const fakes = makeFakes({
      planByProject: { proj_A: 'team', proj_B: 'team' },
      globalOn: true,
      seedKeys: [keyB],
    });
    const app = mountApp({
      middleware: [fakeAuth('admin')],
      accessDeps: fakes.accessDeps,
      readDeps: fakes.readDeps,
    });
    const res = await app.request('/v1/projects/proj_A/mcp/keys/mck_b/revoke', POST);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('cross_project');
    // never revoked
    expect(fakes.revoked).toHaveLength(0);
    expect(fakes.keys.get('mck_b')!.revokedAt).toBeNull();
  });

  it('the owning project CAN revoke its own key', async () => {
    const keyB = makeKey('mck_b', 'proj_B');
    const fakes = makeFakes({
      planByProject: { proj_B: 'team' },
      globalOn: true,
      seedKeys: [keyB],
    });
    const app = mountApp({
      middleware: [fakeAuth('admin')],
      accessDeps: fakes.accessDeps,
      readDeps: fakes.readDeps,
    });
    const res = await app.request('/v1/projects/proj_B/mcp/keys/mck_b/revoke', POST);
    expect(res.status).toBe(200);
    expect(fakes.revoked).toContain('mck_b');
  });

  it('an unknown key → 404', async () => {
    const fakes = makeFakes({ planByProject: { proj_A: 'team' }, globalOn: true });
    const app = mountApp({
      middleware: [fakeAuth('admin')],
      accessDeps: fakes.accessDeps,
      readDeps: fakes.readDeps,
    });
    const res = await app.request('/v1/projects/proj_A/mcp/keys/mck_nope/revoke', POST);
    expect(res.status).toBe(404);
  });
});
