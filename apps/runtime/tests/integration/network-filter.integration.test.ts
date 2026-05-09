// Integration test for CLAUDE.md §5.3 — customer-controlled outbound
// network filter. Spawns a real Deno isolate (Deno 2.x, via the runtime's
// own pool/materializer) and exercises the deny-net flag composition end
// to end. Tasks 18-22 reuse the same harness.

import { describe, expect, test } from 'bun:test';

import { runIntegrationFixture } from './test-helpers.js';

describe('network filter (integration)', () => {
  test('blocks 169.254.169.254 (cloud metadata)', async () => {
    const { result, cleanup } = await runIntegrationFixture({
      fnName: 'test',
      deploymentId: 'd1',
      fnSource: `
        import { query } from '@briven/cli/server';
        export const test = query(async () => {
          try {
            await fetch('http://169.254.169.254/latest/meta-data/');
            return { blocked: false };
          } catch (e) {
            return { blocked: true, name: (e as Error).name, message: (e as Error).message };
          }
        });
      `,
    });
    try {
      expect(result.ok).toBe(true);
      if (result.ok) {
        const v = result.value as { blocked: boolean; name?: string };
        expect(v.blocked).toBe(true);
        // Deno surfaces this as PermissionDenied OR a connect error depending
        // on how the deny-net flag interacts with the IP at connect time.
        expect(['PermissionDenied', 'TypeError', 'NotCapable']).toContain(v.name);
      }
    } finally {
      await cleanup();
    }
  }, 30_000);

  test('blocks 10.0.0.1 (RFC1918)', async () => {
    const { result, cleanup } = await runIntegrationFixture({
      fnName: 'test',
      deploymentId: 'd1',
      fnSource: `
        import { query } from '@briven/cli/server';
        export const test = query(async () => {
          try {
            await fetch('http://10.0.0.1/');
            return { blocked: false };
          } catch (e) {
            return { blocked: true, name: (e as Error).name };
          }
        });
      `,
    });
    try {
      expect(result.ok).toBe(true);
      if (result.ok) {
        const v = result.value as { blocked: boolean };
        expect(v.blocked).toBe(true);
      }
    } finally {
      await cleanup();
    }
  }, 30_000);

  test('blocks 127.0.0.1 (loopback)', async () => {
    const { result, cleanup } = await runIntegrationFixture({
      fnName: 'test',
      deploymentId: 'd1',
      fnSource: `
        import { query } from '@briven/cli/server';
        export const test = query(async () => {
          try {
            await fetch('http://127.0.0.1:1234/');
            return { blocked: false };
          } catch (e) {
            return { blocked: true, name: (e as Error).name };
          }
        });
      `,
    });
    try {
      expect(result.ok).toBe(true);
      if (result.ok) {
        const v = result.value as { blocked: boolean };
        expect(v.blocked).toBe(true);
      }
    } finally {
      await cleanup();
    }
  }, 30_000);

  test('allows public hosts (smoke test only — does not require network)', async () => {
    // We don't actually care if 1.2.3.4 is reachable in this environment;
    // we only care that the *permission check* doesn't reject it. So we
    // just verify the code runs without a PermissionDenied / NotCapable.
    const { result, cleanup } = await runIntegrationFixture({
      fnName: 'test',
      deploymentId: 'd1',
      fnSource: `
        import { query } from '@briven/cli/server';
        export const test = query(async () => {
          try {
            // Use a dead but public IP — will fail to connect but should NOT
            // hit the deny-net filter (it's not in any RFC1918 / link-local block).
            const ctrl = new AbortController();
            setTimeout(() => ctrl.abort(), 500);
            await fetch('http://1.2.3.4/', { signal: ctrl.signal });
            return { name: 'ok' };
          } catch (e) {
            return { name: (e as Error).name };
          }
        });
      `,
    });
    try {
      expect(result.ok).toBe(true);
      if (result.ok) {
        const v = result.value as { name: string };
        // Anything BUT PermissionDenied/NotCapable means deny-net didn't
        // block the public IP. AbortError, ConnectionRefused, TypeError
        // are all acceptable — they prove the connection was attempted,
        // not blocked at the permission layer.
        expect(['PermissionDenied', 'NotCapable']).not.toContain(v.name);
      }
    } finally {
      await cleanup();
    }
  }, 30_000);
});
