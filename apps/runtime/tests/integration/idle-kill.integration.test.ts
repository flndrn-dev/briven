// Integration test for CLAUDE.md §7.3 — isolates idle longer than
// `idleKillMs` get retired by the sweeper. The next invocation must
// cold-start a fresh process (different PID). We use the test-only
// `triggerIdleCheck()` hook on `IsolatePoolImpl` to drive the sweeper
// deterministically rather than wait for the 30s production interval.

import { describe, expect, test } from 'bun:test';

import { runIdleKillFixture } from './test-helpers.js';

describe('idle kill (integration)', () => {
  test('isolate killed after idleKillMs elapses; next invoke cold-starts', async () => {
    const { firstPid, secondPid, cleanup } = await runIdleKillFixture({
      fnName: 'v',
      deploymentId: 'd1',
      idleKillMs: 100, // tiny idle threshold
      fnSource: `
        import { query } from '@briven/cli/server';
        export const v = query(async () => 'ok');
      `,
    });
    try {
      expect(firstPid).toBeGreaterThan(0);
      expect(secondPid).toBeGreaterThan(0);
      expect(firstPid).not.toBe(secondPid);
    } finally {
      await cleanup();
    }
  }, 30_000);
});
