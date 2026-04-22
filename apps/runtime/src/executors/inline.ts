import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { withProjectTx } from '../db.js';
import { makeCtx } from '../query-builder.js';
import type { Bundle, InvokeRequest, InvokeResult } from '../types.js';

/**
 * Phase 1 executor — runs user code inline in the runtime host process,
 * inside a per-invoke transaction scoped to the project's data-plane
 * schema.
 *
 * **NOT isolated.** Dogfood-only shortcut per BUILD_PLAN Phase 1 week 5-6.
 * Flip BRIVEN_RUNTIME_EXECUTOR=deno once that executor lands. Do NOT use
 * `inline` in any environment that accepts external traffic.
 */
export async function invokeInline(
  bundle: Bundle,
  request: InvokeRequest,
): Promise<InvokeResult> {
  if (!bundle.functionNames.includes(request.functionName)) {
    return {
      ok: false,
      code: 'function_not_found',
      message: `function '${request.functionName}' not found in deployment ${bundle.deploymentId}`,
      durationMs: 0,
    };
  }

  const modPath = resolve(bundle.directory, 'functions', `${request.functionName}.ts`);
  const started = performance.now();

  try {
    const mod = await import(pathToFileURL(modPath).href);
    const fn = mod[request.functionName] ?? mod.default;
    if (typeof fn !== 'function') {
      return {
        ok: false,
        code: 'function_not_exported',
        message: `module did not export '${request.functionName}' or default`,
        durationMs: Math.round(performance.now() - started),
      };
    }

    const value = await withProjectTx(request.projectId, async (tx) => {
      const ctx = makeCtx(tx, { requestId: request.requestId, auth: request.auth });
      return fn(ctx, request.args);
    });

    return {
      ok: true,
      value,
      durationMs: Math.round(performance.now() - started),
    };
  } catch (err) {
    return {
      ok: false,
      code: 'user_code_error',
      // Never leak stack traces to the caller — only the type+message.
      message: err instanceof Error ? err.message : String(err),
      durationMs: Math.round(performance.now() - started),
    };
  }
}
