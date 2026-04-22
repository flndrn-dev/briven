import type { Bundle, InvokeRequest, InvokeResult } from '../types.js';

/**
 * Deno subprocess executor — real tenant isolation per CLAUDE.md §7.3.
 *
 * This is a stub. The implementation arrives alongside the runtime server
 * hardening milestone in BUILD_PLAN Phase 2. Shape expectations:
 *
 *  - one long-lived `deno run` subprocess per (projectId, deploymentId)
 *  - permissions locked to `--allow-net=<project-allowlist>`,
 *    `--allow-env=<project-env-keys>`, no fs beyond `/tmp/<isolate-id>`
 *  - stdin/stdout JSON-RPC: `{ id, method: 'invoke', params }` → `{ id, result | error }`
 *  - isolate killed + replaced after 10 min idle OR 1,000 invocations OR any crash
 */
export async function invokeDeno(
  _bundle: Bundle,
  _request: InvokeRequest,
): Promise<InvokeResult> {
  return {
    ok: false,
    code: 'executor_not_implemented',
    message: 'deno executor is scheduled for BUILD_PLAN phase 2',
    durationMs: 0,
  };
}
