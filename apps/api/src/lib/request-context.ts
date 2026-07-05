import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context carried through async boundaries.
 *
 * Better Auth's `databaseHooks` (see services/auth-tenant-pool.ts) run deep
 * inside the auth library and never receive the originating HTTP request, so
 * they can't read the visitor IP on their own. The auth-tenant bridge in
 * routes/auth-service.ts sets this context (IP + projectId) around the call
 * to Better Auth's handler; the user.create hook then reads it back to
 * capture the sign-up's raw IP + geo (control-plane SEO analytics).
 *
 * AsyncLocalStorage propagates the value to every promise/callback spawned
 * within `runWithRequestContext`, so no plumbing through function signatures
 * is required. Outside a run scope `getRequestContext()` returns undefined.
 */
export interface RequestContext {
  /** Raw visitor IP (first value of cf-connecting-ip / x-forwarded-for). */
  ip: string | null;
  /** The tenant/project the request resolved to, when known. */
  projectId?: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with `ctx` readable via getRequestContext() for its whole async tree. */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The active request context, or undefined when called outside a run scope. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
