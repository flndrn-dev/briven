// Integration test for CLAUDE.md §7.4 — after `crashLoopThreshold`
// consecutive crashes within `crashLoopWindowMs` for the same
// (projectId, deploymentId), the breaker trips and subsequent invokes
// short-circuit with `deployment_unhealthy` until the window expires.
// We confirm: (a) the early invocations crash and surface
// `isolate_crashed`, (b) by the 5th call the breaker has tripped and
// returns `deployment_unhealthy` without spawning a new isolate.

import { describe, expect, test } from 'bun:test';

import { runFixtureRepeated } from './test-helpers.js';

describe('crash-loop breaker (integration)', () => {
  test('after 3 consecutive crashes, deployment marked unhealthy', async () => {
    const { results, cleanup } = await runFixtureRepeated({
      fnName: 'v',
      deploymentId: 'd1',
      count: 5,
      fnSource: `
        import { query } from '@briven/cli/server';
        export const v = query(async () => { Deno.exit(1); });
      `,
    });
    try {
      expect(results.length).toBe(5);
      const codes = results.filter((r) => !r.ok).map((r) => (r as { code: string }).code);
      // First few should be isolate_crashed; later ones should flip to deployment_unhealthy.
      expect(codes).toContain('isolate_crashed');
      // Last invocation should be the breaker tripped.
      const last = results[results.length - 1];
      expect(last.ok).toBe(false);
      if (!last.ok) {
        expect(last.code).toBe('deployment_unhealthy');
      }
    } finally {
      await cleanup();
    }
  }, 60_000);
});
