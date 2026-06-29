import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { newId } from '@briven/shared';

import { withProjectTx } from '../db.js';
import { env } from '../env.js';
import { createLogCollector, installConsolePatch, runWithCollector } from '../log-collector.js';
import { publishInvocation } from '../log-publisher.js';
import { makeCtx } from '../query-builder.js';
import type { Bundle, InvokeRequest, InvokeResult } from '../types.js';

// One-time install at module load — no-op on re-import.
installConsolePatch();

/** Thrown when user code exceeds the invocation timeout (see invokeInline). */
class InvocationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`invocation exceeded ${timeoutMs}ms`);
    this.name = 'InvocationTimeoutError';
  }
}

/**
 * Phase 1 executor — runs user code inline in the runtime host process,
 * inside a per-invoke transaction scoped to the project's data-plane
 * schema.
 *
 * **NOT isolated.** Dogfood-only shortcut per BUILD_PLAN Phase 1 week 5-6.
 * Flip BRIVEN_RUNTIME_EXECUTOR=deno once that executor lands. Do NOT use
 * `inline` in any environment that accepts external traffic.
 *
 * Per-invocation, we create a LogCollector, run the user function inside
 * an AsyncLocalStorage binding so both `ctx.log.*` and `console.*` route
 * through it, then publish a single structured envelope to Redis for
 * `briven logs --tail` and the log-fanout worker.
 */
export async function invokeInline(bundle: Bundle, request: InvokeRequest): Promise<InvokeResult> {
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
  const collector = createLogCollector();
  const invocationId = newId('inv');

  let result: InvokeResult;
  try {
    const mod = await runWithCollector(collector, () => import(pathToFileURL(modPath).href));
    const fn = mod[request.functionName] ?? mod.default;
    if (typeof fn !== 'function') {
      result = {
        ok: false,
        code: 'function_not_exported',
        message: `module did not export '${request.functionName}' or default`,
        durationMs: Math.round(performance.now() - started),
      };
    } else {
      const { value, touched } = await withProjectTx(request.projectId, async (tx) => {
        const { ctx, touched } = makeCtx(tx, {
          requestId: request.requestId,
          auth: request.auth,
          env: request.env,
          log: collector,
        });
        // Cap how long user code may run. Inline is the DEFAULT executor and
        // runs in this host process, so a user infinite-loop would otherwise
        // hang the whole runtime. Promise.race trips a timeout that rejects
        // (rolling back the tx via withProjectTx's catch) and surfaces as an
        // `invocation_timeout` result below. NOTE: with `inline` we cannot
        // truly kill the runaway promise — it keeps running in the background
        // — but the invocation returns and the DB client is released. The
        // `deno` executor (Phase 2, customer-facing) hard-kills the isolate.
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        try {
          const v = await Promise.race([
            runWithCollector(collector, () => fn(ctx, request.args)),
            new Promise<never>((_, reject) => {
              timeoutHandle = setTimeout(() => {
                reject(new InvocationTimeoutError(env.BRIVEN_RUNTIME_INVOCATION_TIMEOUT_MS));
              }, env.BRIVEN_RUNTIME_INVOCATION_TIMEOUT_MS);
            }),
          ]);
          return { value: v, touched };
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }
      });
      result = {
        ok: true,
        value,
        durationMs: Math.round(performance.now() - started),
        touchedTables: [...touched],
      };
    }
  } catch (err) {
    result = {
      ok: false,
      // A timeout is its own code so callers/metrics can distinguish a
      // runaway loop from an ordinary thrown error.
      code: err instanceof InvocationTimeoutError ? 'invocation_timeout' : 'function_threw',
      // Never leak stack traces to the caller — only the type+message.
      message: err instanceof Error ? err.message : String(err),
      durationMs: Math.round(performance.now() - started),
    };
  }

  // Publish the envelope regardless of success — failures are the thing
  // `briven logs --tail` users most want to see.
  const userLogs = collector.drain();
  await publishInvocation({
    projectId: request.projectId,
    deploymentId: request.deploymentId,
    invocationId,
    functionName: request.functionName,
    status: result.ok ? 'ok' : 'err',
    durationMs: result.durationMs,
    touchedTables: result.ok ? result.touchedTables : (result.touchedTables ?? []),
    userLogs,
    errCode: result.ok ? undefined : result.code,
    errMessage: result.ok ? undefined : result.message,
    ts: new Date().toISOString(),
  });

  return result;
}
