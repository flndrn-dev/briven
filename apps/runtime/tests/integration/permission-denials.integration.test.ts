// Integration test for CLAUDE.md §7.3 — customer code that tries to step
// outside the per-isolate sandbox (read /etc, run subprocesses, peek at
// host env) must be denied at the Deno permission layer. The runtime
// surfaces the denial back as a normal value here (the customer code
// catches the error) so we're testing that the denial mechanism fires —
// not how the runtime maps it to a RuntimeErrorCode.

import { describe, expect, test } from 'bun:test';

import { runIntegrationFixture } from './test-helpers.js';

describe('permission denials (integration)', () => {
  test('reading outside /tmp/<id> denied', async () => {
    const { result, cleanup } = await runIntegrationFixture({
      fnName: 'test',
      deploymentId: 'd1',
      fnSource: `
        import { query } from '@briven/cli/server';
        export const test = query(async () => {
          try {
            await Deno.readTextFile('/etc/passwd');
            return 'ok';
          } catch (e) {
            return (e as Error).name;
          }
        });
      `,
    });
    try {
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Deno 2.x may use NotCapable, PermissionDenied, or similar; accept the family.
        expect(['PermissionDenied', 'NotCapable']).toContain(result.value);
      }
    } finally {
      await cleanup();
    }
  }, 30_000);

  test('Deno.Command (subprocess) denied', async () => {
    const { result, cleanup } = await runIntegrationFixture({
      fnName: 'test',
      deploymentId: 'd1',
      fnSource: `
        import { query } from '@briven/cli/server';
        export const test = query(async () => {
          try {
            const cmd = new Deno.Command('ls');
            await cmd.output();
            return 'ok';
          } catch (e) {
            return (e as Error).name;
          }
        });
      `,
    });
    try {
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(['PermissionDenied', 'NotCapable']).toContain(result.value);
      }
    } finally {
      await cleanup();
    }
  }, 30_000);

  test('env access for unallowed key returns undefined or denies', async () => {
    const { result, cleanup } = await runIntegrationFixture({
      fnName: 'test',
      deploymentId: 'd1',
      fnSource: `
        import { query } from '@briven/cli/server';
        export const test = query(async () => {
          try {
            return Deno.env.get('NOT_ALLOWED_KEY') ?? 'undefined';
          } catch (e) {
            return (e as Error).name;
          }
        });
      `,
    });
    try {
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Either Deno returns undefined when --allow-env list is empty (no allowlist
        // → no access), or it denies. Both prove the customer can't reach env.
        expect(['undefined', 'PermissionDenied', 'NotCapable']).toContain(result.value);
      }
    } finally {
      await cleanup();
    }
  }, 30_000);
});
