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
 * Wrap a customer mutation (a function allowed to write). Like `query`, this is
 * an author-intent marker — the host already knows a deployed function is a
 * mutation from its registration, and grants it a writable transaction. Must be
 * exported here because every `briven/functions/*` write imports it; without it
 * the isolate fails at module load with "does not provide an export named
 * 'mutation'" before the function ever runs.
 */
export function mutation<A, R>(
  fn: (ctx: Ctx, args: A) => Promise<R> | R,
): (ctx: Ctx, args: A) => Promise<R> | R {
  return fn;
}

/** Wrap a customer action (side-effecting, non-transactional). Author-intent marker. */
export function action<A, R>(
  fn: (ctx: Ctx, args: A) => Promise<R> | R,
): (ctx: Ctx, args: A) => Promise<R> | R {
  return fn;
}

// Crockford base32 — matches the `ulid` npm package the host-side helper uses,
// reimplemented inline because the isolate is a self-contained materialized file
// with no node_modules.
const ULID_ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function ulidRaw(): string {
  let time = Date.now();
  const timeChars: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    timeChars.unshift(ULID_ENCODING[time % 32]!);
    time = Math.floor(time / 32);
  }
  const rand = new Uint8Array(16);
  crypto.getRandomValues(rand);
  let randChars = '';
  for (let i = 0; i < 16; i += 1) randChars += ULID_ENCODING[rand[i]! % 32];
  return timeChars.join('') + randChars;
}

/**
 * Prefixed, lexicographically-sortable id for a row in one of your own tables,
 * e.g. `ulid('td')` → `'td_01HZ5E4...'`. Mirrors `@briven/cli/server`'s `ulid`.
 */
export function ulid(prefix: string): string {
  return `${prefix}_${ulidRaw()}`;
}

/**
 * The throwable every function uses for typed failures ({ code, message, status }).
 * Inlined to mirror `@briven/shared`'s `brivenError` so the host serialises a
 * thrown error's code/status into the customer-facing error frame.
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

// Re-export low-level helpers if customers want them.
export { runQuery };
