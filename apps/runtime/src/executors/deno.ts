import { getPool } from '../runtime-bootstrap.js';
import type { Bundle, InvokeRequest, InvokeResult } from '../types.js';

/**
 * Deno isolate executor — implements CLAUDE.md §7.3 verbatim.
 * Per-project subprocess pool, single-flight, JSON-RPC over stdin/stdout.
 * See docs/superpowers/specs/2026-04-27-deno-isolate-runtime-design.md.
 *
 * The pool itself is a module-level singleton constructed lazily on the
 * first invoke; idle sweeper, process supervision, and crash-loop breaker
 * all live inside `IsolatePoolImpl`. This file is intentionally tiny —
 * everything load-bearing is in `runtime-bootstrap.ts` and `pool-manager.ts`.
 */
export async function invokeDeno(bundle: Bundle, request: InvokeRequest): Promise<InvokeResult> {
  return getPool().invoke(bundle, request);
}
