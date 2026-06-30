import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, test } from 'bun:test';

import type { McpKey, McpKeyScope } from '../db/schema.js';
import {
  generateMcpKey,
  hashMcpKey,
  verifyMcpKey,
  type McpVerifyDeps,
} from './mcp-access.js';
import { assertReadOnlyQuery, buildMcpServer, READ_TOOLS, WRITE_TOOLS } from './mcp-tools.js';

/* ── fixtures ─────────────────────────────────────────────────────────── */

function fakeKey(overrides: Partial<McpKey> = {}): McpKey {
  return {
    id: 'mck_test',
    projectId: 'prj_test',
    name: 'test key',
    hash: 'deadbeef',
    prefix: 'pk_briven_mcp_',
    suffix: 'abcd',
    scope: 'read',
    enabled: true,
    createdBy: 'usr_test',
    createdAt: new Date(),
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function deps(overrides: Partial<McpVerifyDeps> = {}): McpVerifyDeps {
  return {
    getKeyByHash: async () => fakeKey(),
    touchKeyLastUsed: async () => {},
    isGlobalEnabled: async () => true,
    isProjectEnabled: async () => true,
    getProjectPlanTier: async () => 'pro',
    ...overrides,
  };
}

/* ── verifyMcpKey ─────────────────────────────────────────────────────── */

describe('verifyMcpKey', () => {
  test('hashMcpKey mirrors generateMcpKey exactly', () => {
    const k = generateMcpKey();
    expect(hashMcpKey(k.plaintext)).toBe(k.hash);
  });

  test('missing key → 401 missing_key', async () => {
    const r = await verifyMcpKey(null, deps());
    expect(r).toEqual({ ok: false, status: 401, reason: 'missing_key' });
  });

  test('wrong prefix → 401 malformed_key', async () => {
    const r = await verifyMcpKey('sk_not_ours_123', deps());
    expect(r).toEqual({ ok: false, status: 401, reason: 'malformed_key' });
  });

  test('no matching row → 401 unknown_key', async () => {
    const r = await verifyMcpKey('pk_briven_mcp_xyz', deps({ getKeyByHash: async () => null }));
    expect(r).toEqual({ ok: false, status: 401, reason: 'unknown_key' });
  });

  test('revoked key → 401 revoked_key', async () => {
    const r = await verifyMcpKey(
      'pk_briven_mcp_xyz',
      deps({ getKeyByHash: async () => fakeKey({ revokedAt: new Date() }) }),
    );
    expect(r).toEqual({ ok: false, status: 401, reason: 'revoked_key' });
  });

  test('disabled key → 401 revoked_key', async () => {
    const r = await verifyMcpKey(
      'pk_briven_mcp_xyz',
      deps({ getKeyByHash: async () => fakeKey({ enabled: false }) }),
    );
    expect(r).toEqual({ ok: false, status: 401, reason: 'revoked_key' });
  });

  test('global kill-switch off → 403 global_disabled', async () => {
    const r = await verifyMcpKey('pk_briven_mcp_xyz', deps({ isGlobalEnabled: async () => false }));
    expect(r).toEqual({ ok: false, status: 403, reason: 'global_disabled' });
  });

  test('project not enabled → 403 project_disabled', async () => {
    const r = await verifyMcpKey('pk_briven_mcp_xyz', deps({ isProjectEnabled: async () => false }));
    expect(r).toEqual({ ok: false, status: 403, reason: 'project_disabled' });
  });

  test('free-tier project → 403 plan_ineligible', async () => {
    const r = await verifyMcpKey(
      'pk_briven_mcp_xyz',
      deps({ getProjectPlanTier: async () => 'free' }),
    );
    expect(r).toEqual({ ok: false, status: 403, reason: 'plan_ineligible' });
  });

  test('valid pro key → ok with binding, stamps lastUsedAt', async () => {
    const stampedIds: string[] = [];
    const r = await verifyMcpKey(
      'pk_briven_mcp_xyz',
      deps({
        getKeyByHash: async () => fakeKey({ id: 'mck_99', projectId: 'prj_99', scope: 'admin' }),
        touchKeyLastUsed: async (id) => {
          stampedIds.push(id);
        },
      }),
    );
    expect(r).toEqual({ ok: true, keyId: 'mck_99', projectId: 'prj_99', scope: 'admin' });
    expect(stampedIds).toEqual(['mck_99']);
  });
});

/* ── read-only query guard ────────────────────────────────────────────── */

describe('assertReadOnlyQuery', () => {
  test('accepts a plain SELECT', () => {
    expect(assertReadOnlyQuery('SELECT * FROM notes')).toBe('SELECT * FROM notes');
  });
  test('accepts a WITH … SELECT and strips trailing semicolon', () => {
    expect(assertReadOnlyQuery('WITH x AS (SELECT 1) SELECT * FROM x;')).toBe(
      'WITH x AS (SELECT 1) SELECT * FROM x',
    );
  });
  test.each([
    'INSERT INTO notes VALUES (1)',
    'UPDATE notes SET a = 1',
    'DELETE FROM notes',
    'DROP TABLE notes',
    'TRUNCATE notes',
    'SELECT 1; DROP TABLE notes',
    'WITH x AS (DELETE FROM notes RETURNING *) SELECT * FROM x',
  ])('rejects write/multi-statement: %s', (sql) => {
    expect(() => assertReadOnlyQuery(sql)).toThrow();
  });
});

/* ── tools/list scope filtering + isolation contract ──────────────────── */

async function listToolsForScope(scope: McpKeyScope) {
  const server = buildMcpServer({
    keyId: 'mck_x',
    projectId: 'prj_x',
    scope,
    ipHash: null,
    userAgent: null,
  });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const { tools } = await client.listTools();
  await client.close();
  await server.close();
  return tools;
}

describe('buildMcpServer — tools/list by scope', () => {
  test('read key sees ONLY the read tools, no write tools', async () => {
    const tools = await listToolsForScope('read');
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...READ_TOOLS].sort());
    for (const w of WRITE_TOOLS) expect(names).not.toContain(w);
  });

  test('read-write key sees read + write tools', async () => {
    const tools = await listToolsForScope('read-write');
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
  });

  test('admin key sees read + write tools', async () => {
    const tools = await listToolsForScope('admin');
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
  });

  test('THE ISOLATION CONTRACT: no tool exposes a projectId argument', async () => {
    for (const scope of ['read', 'read-write', 'admin'] as const) {
      const tools = await listToolsForScope(scope);
      for (const tool of tools) {
        const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties;
        const propNames = props ? Object.keys(props) : [];
        expect(propNames).not.toContain('projectId');
        expect(propNames).not.toContain('project_id');
      }
    }
  });
});
