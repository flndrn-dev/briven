// Runs inside the Deno isolate. Materialized by host into
// /tmp/briven-isolate-<id>/.briven-runtime/server.ts. Customers reach
// this via `import { query } from '@briven/cli/server'` resolved through
// the host-controlled import-map.json.

import { runQuery, type Ctx } from './loop.ts';

export type { Ctx };

/**
 * Wrap a customer query function. Customer code does:
 *
 *     import { query } from '@briven/cli/server';
 *     export const poolStats = query(async (ctx, args) => {
 *       const pools = await ctx.db('pools').select();
 *       return { count: pools.length };
 *     });
 *
 * The wrapper is mostly a marker — the dispatcher in __entry.ts already
 * knows what's exported. Returning the function untouched keeps semantics
 * symmetric with the inline executor.
 */
export function query<A, R>(
  fn: (ctx: Ctx, args: A) => Promise<R> | R,
): (ctx: Ctx, args: A) => Promise<R> | R {
  return fn;
}

// Re-export low-level helpers if customers want them. Phase 1: just `query`.
export { runQuery };
