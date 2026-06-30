import { describe, expect, test } from 'bun:test';

import type { AuditEntry } from './audit.js';
import {
  deleteRevokedKey,
  disableForProject,
  enableForProject,
  generateMcpKey,
  isPlanEligibleForMcp,
  issueKey,
  MCP_KEY_PREFIX,
  McpKeyNotRevokedError,
  McpPlanRequiredError,
  maskKey,
  revokeKey,
  setGlobalEnabled,
  type McpAccessDeps,
  type McpActor,
} from './mcp-access.js';
import type { McpKey, NewMcpKey, ProjectTier } from '../db/schema.js';

/* ─── in-memory deps so the mutators are testable without a DB ──────────── */

interface Fake {
  deps: McpAccessDeps;
  audits: AuditEntry[];
  keys: Map<string, McpKey>;
  projectEnabled: Map<string, boolean>;
  globalOn: boolean | null;
}

function makeFake(planByProject: Record<string, ProjectTier | null>): Fake {
  const audits: AuditEntry[] = [];
  const keys = new Map<string, McpKey>();
  const projectEnabled = new Map<string, boolean>();
  const state = { globalOn: null as boolean | null };

  const deps: McpAccessDeps = {
    async setGlobalSetting(on) {
      state.globalOn = on;
    },
    async getProjectPlanTier(projectId) {
      return projectId in planByProject ? planByProject[projectId]! : null;
    },
    async setProjectEnabled(projectId, on) {
      projectEnabled.set(projectId, on);
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
      const row = keys.get(keyId);
      if (row) keys.set(keyId, { ...row, revokedAt: new Date(), enabled: false });
    },
    async deleteKey(keyId) {
      keys.delete(keyId);
    },
    async audit(entry) {
      audits.push(entry);
    },
  };

  return {
    deps,
    audits,
    keys,
    projectEnabled,
    get globalOn() {
      return state.globalOn;
    },
  } as Fake;
}

const actor: McpActor = { id: 'usr_admin', ipHash: null, userAgent: null };

describe('isPlanEligibleForMcp (the plan gate, pure)', () => {
  test('pro and team qualify', () => {
    expect(isPlanEligibleForMcp('pro')).toBe(true);
    expect(isPlanEligibleForMcp('team')).toBe(true);
  });
  test('free / null / undefined never qualify', () => {
    expect(isPlanEligibleForMcp('free')).toBe(false);
    expect(isPlanEligibleForMcp(null)).toBe(false);
    expect(isPlanEligibleForMcp(undefined)).toBe(false);
  });
});

describe('enableForProject (server-side plan gate)', () => {
  test('(a) REJECTS a free-tier project — even called directly', async () => {
    const fake = makeFake({ proj_free: 'free' });
    await expect(enableForProject('proj_free', actor, fake.deps)).rejects.toBeInstanceOf(
      McpPlanRequiredError,
    );
    // gate fired before any state change
    expect(fake.projectEnabled.has('proj_free')).toBe(false);
    expect(fake.audits).toHaveLength(0);
  });

  test('rejects an unknown project (tier null)', async () => {
    const fake = makeFake({});
    await expect(enableForProject('nope', actor, fake.deps)).rejects.toBeInstanceOf(
      McpPlanRequiredError,
    );
  });

  test('(b) ACCEPTS a Pro project and (e) records an audit row', async () => {
    const fake = makeFake({ proj_pro: 'pro' });
    const res = await enableForProject('proj_pro', actor, fake.deps);
    expect(res).toEqual({ projectId: 'proj_pro', enabled: true });
    expect(fake.projectEnabled.get('proj_pro')).toBe(true);
    expect(fake.audits).toHaveLength(1);
    expect(fake.audits[0]!.action).toBe('mcp.project.enable');
    expect(fake.audits[0]!.projectId).toBe('proj_pro');
  });

  test('(b) ACCEPTS a Team project', async () => {
    const fake = makeFake({ proj_team: 'team' });
    await expect(enableForProject('proj_team', actor, fake.deps)).resolves.toEqual({
      projectId: 'proj_team',
      enabled: true,
    });
  });
});

describe('issueKey (one-time reveal)', () => {
  test('(c) returns the FULL key once, then only prefix/suffix are exposed', async () => {
    const fake = makeFake({ proj_pro: 'pro' });
    const issued = await issueKey(
      { projectId: 'proj_pro', name: 'agent-1', scope: 'read' },
      actor,
      fake.deps,
    );

    // Full plaintext returned exactly once.
    expect(issued.plaintext.startsWith(MCP_KEY_PREFIX)).toBe(true);
    expect(issued.plaintext.length).toBeGreaterThan(MCP_KEY_PREFIX.length + 20);

    // The masked key carries NO plaintext and NO hash — only prefix…suffix.
    expect(issued.key).not.toHaveProperty('hash');
    expect(issued.key).not.toHaveProperty('plaintext');
    expect(issued.key.prefix).toBe(MCP_KEY_PREFIX);
    expect(issued.key.suffix).toBe(issued.plaintext.slice(-4));

    // What's stored is the hash, never the plaintext.
    const stored = fake.keys.get(issued.key.id)!;
    expect(stored.hash).not.toContain(issued.plaintext);
    expect(JSON.stringify(maskKey(stored))).not.toContain(issued.plaintext);

    // audit row recorded for the issue.
    expect(fake.audits.some((a) => a.action === 'mcp.key.issue')).toBe(true);
  });

  test('plan gate also guards key issue (free rejected)', async () => {
    const fake = makeFake({ proj_free: 'free' });
    await expect(
      issueKey({ projectId: 'proj_free', name: 'x', scope: 'read' }, actor, fake.deps),
    ).rejects.toBeInstanceOf(McpPlanRequiredError);
    expect(fake.keys.size).toBe(0);
  });
});

describe('revokeKey', () => {
  test('(d) disables the key (enabled false + revoked_at set) and audits', async () => {
    const fake = makeFake({ proj_pro: 'pro' });
    const issued = await issueKey(
      { projectId: 'proj_pro', name: 'agent-1', scope: 'read' },
      actor,
      fake.deps,
    );
    expect(fake.keys.get(issued.key.id)!.enabled).toBe(true);

    const res = await revokeKey(issued.key.id, actor, fake.deps);
    expect(res).toEqual({ keyId: issued.key.id, revoked: true });

    const stored = fake.keys.get(issued.key.id)!;
    expect(stored.enabled).toBe(false);
    expect(stored.revokedAt).not.toBeNull();
    expect(fake.audits.some((a) => a.action === 'mcp.key.revoke')).toBe(true);
  });

  test('throws NotFound for an unknown key id', async () => {
    const fake = makeFake({});
    await expect(revokeKey('mck_nope', actor, fake.deps)).rejects.toThrow();
  });
});

describe('deleteRevokedKey (revoke-then-delete)', () => {
  test('refuses an ACTIVE key with McpKeyNotRevokedError — row survives', async () => {
    const fake = makeFake({ proj_pro: 'pro' });
    const issued = await issueKey(
      { projectId: 'proj_pro', name: 'agent-1', scope: 'read' },
      actor,
      fake.deps,
    );
    await expect(deleteRevokedKey(issued.key.id, actor, fake.deps)).rejects.toThrow(
      McpKeyNotRevokedError,
    );
    expect(fake.keys.has(issued.key.id)).toBe(true);
    expect(fake.audits.some((a) => a.action === 'mcp.key.deleted')).toBe(false);
  });

  test('deletes an already-revoked key (row gone) and audits mcp.key.deleted', async () => {
    const fake = makeFake({ proj_pro: 'pro' });
    const issued = await issueKey(
      { projectId: 'proj_pro', name: 'agent-1', scope: 'read' },
      actor,
      fake.deps,
    );
    await revokeKey(issued.key.id, actor, fake.deps);

    const res = await deleteRevokedKey(issued.key.id, actor, fake.deps);
    expect(res).toEqual({ keyId: issued.key.id, deleted: true });
    expect(fake.keys.has(issued.key.id)).toBe(false);
    expect(fake.audits.some((a) => a.action === 'mcp.key.deleted')).toBe(true);
  });

  test('throws NotFound for an unknown key id', async () => {
    const fake = makeFake({});
    await expect(deleteRevokedKey('mck_nope', actor, fake.deps)).rejects.toThrow();
  });
});

describe('global kill-switch + disable', () => {
  test('setGlobalEnabled persists + audits mcp.global.toggle', async () => {
    const fake = makeFake({});
    const res = await setGlobalEnabled(true, actor, fake.deps);
    expect(res).toEqual({ enabled: true });
    expect(fake.globalOn).toBe(true);
    expect(fake.audits[0]!.action).toBe('mcp.global.toggle');
  });

  test('disableForProject flips off + audits (no plan gate)', async () => {
    const fake = makeFake({ proj_free: 'free' });
    const res = await disableForProject('proj_free', actor, fake.deps);
    expect(res).toEqual({ projectId: 'proj_free', enabled: false });
    expect(fake.projectEnabled.get('proj_free')).toBe(false);
    expect(fake.audits[0]!.action).toBe('mcp.project.disable');
  });
});

describe('generateMcpKey', () => {
  test('hash is sha-256 hex of the plaintext, suffix is its last 4', () => {
    const k = generateMcpKey();
    expect(k.prefix).toBe(MCP_KEY_PREFIX);
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(k.suffix).toBe(k.plaintext.slice(-4));
    expect(k.plaintext).not.toBe(k.hash);
  });
});
