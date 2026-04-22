/**
 * Shared types between the runtime host, its executors, and the apps/api
 * control plane that drives it.
 */

export interface InvokeRequest {
  readonly projectId: string;
  readonly functionName: string;
  readonly args: unknown;
  readonly deploymentId: string;
  readonly requestId: string;
  readonly auth: InvokeAuth | null;
}

export interface InvokeAuth {
  readonly userId: string;
  readonly tokenType: 'session' | 'api_key';
}

export type InvokeResult =
  | { ok: true; value: unknown; durationMs: number }
  | {
      ok: false;
      code: string;
      message: string;
      durationMs: number;
    };

/**
 * A deployed bundle. For Phase 1 the runtime reads plain `.ts` files from
 * disk and executes them via `inline`. Phase 2 introduces signed, content-
 * addressed bundles plus the Deno executor that enforces the permission
 * model from CLAUDE.md §7.3.
 */
export interface Bundle {
  readonly projectId: string;
  readonly deploymentId: string;
  readonly functionNames: readonly string[];
  readonly directory: string;
}
