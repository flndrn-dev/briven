// Integration test for CLAUDE.md §7.3 — when the deploymentId changes for
// an existing project, the next invocation must retire the old isolate
// and cold-start a fresh one against the new bundle. We assert that two
// invocations against the same projectId (but different deploymentIds)
// produce two distinct PIDs, and that each invocation returns the value
// from its own bundle (so we know the new deployment really took effect).

import { describe, expect, test } from 'bun:test';

import { runTwoSequentialInvocations } from './test-helpers.js';

describe('deploy invalidation (integration)', () => {
  test('changing deploymentId retires the old isolate and respawns fresh', async () => {
    const { first, second, pidsObserved, cleanup } = await runTwoSequentialInvocations({
      first: {
        fnName: 'v',
        deploymentId: 'd1',
        fnSource: `
          import { query } from '@briven/cli/server';
          export const v = query(async () => 'A');
        `,
      },
      second: {
        fnName: 'v',
        deploymentId: 'd2',
        fnSource: `
          import { query } from '@briven/cli/server';
          export const v = query(async () => 'B');
        `,
      },
    });
    try {
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (first.ok) expect(first.value).toBe('A');
      if (second.ok) expect(second.value).toBe('B');
      expect(pidsObserved.length).toBeGreaterThanOrEqual(2);
      // Two distinct PIDs prove the second invocation got a fresh isolate.
      const unique = new Set(pidsObserved);
      expect(unique.size).toBe(2);
    } finally {
      await cleanup();
    }
  }, 60_000);
});
