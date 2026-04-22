import { loadCurrentBundle } from './bundle-store.js';
import { env } from './env.js';
import { invokeDeno } from './executors/deno.js';
import { invokeInline } from './executors/inline.js';
import type { InvokeRequest, InvokeResult } from './types.js';

/**
 * Route an invoke request to the configured executor. The control plane
 * (apps/api) is the only caller — authentication of the end user already
 * happened there; the `auth` field on the request is authoritative.
 */
export async function handleInvoke(request: InvokeRequest): Promise<InvokeResult> {
  const started = performance.now();
  const bundle = await loadCurrentBundle(request.projectId);
  if (!bundle) {
    return {
      ok: false,
      code: 'no_deployment',
      message: `project ${request.projectId} has no live deployment`,
      durationMs: Math.round(performance.now() - started),
    };
  }

  switch (env.BRIVEN_RUNTIME_EXECUTOR) {
    case 'inline':
      return invokeInline(bundle, request);
    case 'deno':
      return invokeDeno(bundle, request);
  }
}
