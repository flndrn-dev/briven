// Integration test for CLAUDE.md §7.3 — V8 heap cap enforced via
// `--v8-flags=--max-old-space-size=<maxMemoryMb>`. Customer code that
// allocates beyond the cap should crash the isolate (V8 OOM). We accept
// any of the kill-coded errors since the exact surface depends on
// whether V8 throws a clean RangeError before the heap is exhausted or
// the process gets killed mid-allocation.

import { describe, expect, test } from 'bun:test';

import { runIntegrationFixture } from './test-helpers.js';

describe('memory cap (integration)', () => {
  test('allocating beyond cap kills isolate', async () => {
    const { result, cleanup } = await runIntegrationFixture({
      fnName: 'test',
      deploymentId: 'd1',
      poolConfig: { maxMemoryMb: 64, invocationTimeoutMs: 15_000 },
      fnSource: `
        import { query } from '@briven/cli/server';
        export const test = query(async () => {
          // V8's --max-old-space-size caps the old-generation heap. Long
          // strings get an "external" backing store outside the heap, and
          // typed-array buffers live in array-buffer-allocator memory — both
          // bypass the cap. Many small JS objects DO live in the old-gen
          // heap, so we allocate millions of them to force a real heap OOM.
          const arr: unknown[] = [];
          for (let i = 0; i < 5_000_000; i++) {
            arr.push({ a: i, b: i * 2, c: i * 3, d: 'k' + i });
          }
          return arr.length;
        });
      `,
    });
    try {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // V8 may surface this as a heap RangeError (function_threw),
        // a process kill (isolate_crashed), or a hung allocation that
        // hits the invocation timeout. All three prove the cap matters.
        expect([
          'isolate_crashed',
          'memory_limit_exceeded',
          'invocation_timeout',
          'function_threw',
        ]).toContain(result.code);
      }
    } finally {
      await cleanup();
    }
  }, 30_000);
});
