import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Ctx } from '@briven/schema';

import type { Bundle, InvokeRequest, InvokeResult } from '../types.js';

/**
 * Phase 1 executor — runs user code inline in the runtime host process.
 *
 * **NOT isolated.** This is a dogfood-only shortcut per BUILD_PLAN Phase 1
 * week 5-6. Flip BRIVEN_RUNTIME_EXECUTOR=deno once that executor lands. Do
 * NOT use `inline` in any environment that accepts external traffic.
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
    const mod = (await import(pathToFileURL(modPath).href)) as Record<
      string,
      (ctx: Ctx, args: unknown) => Promise<unknown>
    >;
    const fn = mod[request.functionName] ?? mod.default;
    if (typeof fn !== 'function') {
      return {
        ok: false,
        code: 'function_not_exported',
        message: `module did not export '${request.functionName}' or default`,
        durationMs: Math.round(performance.now() - started),
      };
    }

    const ctx: Ctx = makeStubCtx(request);
    const value = await fn(ctx, request.args);
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

/**
 * Phase 1 stub for the runtime `Ctx`. The real implementation wires the
 * per-project DbClient, logger, and env injection. For now, db() throws so
 * any query code surfaces as a clean error instead of silently succeeding.
 */
function makeStubCtx(request: InvokeRequest): Ctx {
  const fail = () => {
    throw new Error('ctx.db is not implemented in the phase 1 inline executor');
  };
  const logger: Ctx['log'] = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return {
    db: fail as unknown as Ctx['db'],
    requestId: request.requestId,
    log: logger,
    env: Object.freeze({}),
    auth: request.auth,
  };
}
