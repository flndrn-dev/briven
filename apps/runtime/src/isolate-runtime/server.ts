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

/**
 * Wrap a customer mutation (write) function. Identical wiring to `query` —
 * the `ctx.db(...)` builders already emit INSERT / UPDATE / DELETE frames to
 * the host, which runs them inside the project's writable transaction
 * (query-builder.ts → tx.unsafe). So a mutation needs no extra plumbing; the
 * wrapper is a marker that mirrors the customer CLI's `@briven/cli/server`
 * surface so a function written against the CLI runs unchanged here.
 */
export function mutation<A, R>(
  fn: (ctx: Ctx, args: A) => Promise<R> | R,
): (ctx: Ctx, args: A) => Promise<R> | R {
  return fn;
}

/**
 * Wrap a customer action function — general compute with no implicit DB
 * transaction semantics. It still receives the same `ctx` (so `ctx.db`,
 * `ctx.env`, `ctx.log` all work), and any network it does is governed by the
 * isolate's Deno `--allow-net` / `--deny-net` flags and the fetch shim in
 * loop.ts. Identity wrapper, matching the customer CLI's `action`.
 */
export function action<A, R>(
  fn: (ctx: Ctx, args: A) => Promise<R> | R,
): (ctx: Ctx, args: A) => Promise<R> | R {
  return fn;
}

// ---------------------------------------------------------------------------
// ulid — pure prefixed-ULID string generator.
//
// Mirrors the customer CLI's `ulid` (and @briven/shared's prefixed-id shape,
// e.g. `newId('td')` → "td_01HZ...").  Scaffolded functions call `ulid('td')`
// to mint primary keys, so the runtime must provide it from
// `@briven/cli/server`.  Pure — no host round-trip, no imports (loop.ts is
// resolved by Deno with no node_modules), so we inline a Crockford-base32
// ULID here instead of importing the `ulid` npm package.
// ---------------------------------------------------------------------------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // no I, L, O, U
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number): string {
  let out = '';
  let n = now;
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = n % 32;
    out = CROCKFORD[mod] + out;
    n = (n - mod) / 32;
  }
  return out;
}

function encodeRandom(): string {
  const bytes = new Uint8Array(RANDOM_LEN);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    out += CROCKFORD[bytes[i]! % 32];
  }
  return out;
}

/**
 * Generate a ULID. With a prefix, returns `<prefix>_<ULID>` (e.g.
 * `ulid('td')` → "td_01HZ5E4..."); without one, returns the bare 26-char
 * ULID. Monotonic-within-ms ordering is NOT guaranteed (fresh randomness per
 * call) — fine for primary keys, which only need uniqueness.
 */
export function ulid(prefix?: string): string {
  const id = encodeTime(Date.now()) + encodeRandom();
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * Customer-facing error base, mirrored from `@briven/shared` so functions can
 * `import { brivenError } from '@briven/cli/server'` INSIDE the isolate — which
 * has no node_modules to resolve the real package. Keep the shape in lockstep
 * with packages/shared/src/errors.ts.
 */
export class brivenError extends Error {
  readonly code: string;
  readonly status: number;
  readonly cause?: unknown;
  readonly context?: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    options: { status?: number; cause?: unknown; context?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'brivenError';
    this.code = code;
    this.status = options.status ?? 500;
    this.cause = options.cause;
    this.context = options.context ? Object.freeze({ ...options.context }) : undefined;
  }

  toJSON(): { code: string; message: string; status: number } {
    return { code: this.code, message: this.message, status: this.status };
  }
}

// Full runtime surface exposed to deployed functions via `@briven/cli/server`:
// query · mutation · action · ulid · brivenError (+ low-level runQuery).
export { runQuery };
