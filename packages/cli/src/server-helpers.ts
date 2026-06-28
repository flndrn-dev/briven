/**
 * Identity-function wrappers that document intent on the author side
 * and give us a future enforcement hook (e.g. read-only transactions
 * on `query`). The runtime infers query/mutation/action from where
 * the file lives on disk today, not from these wrappers — but
 * declaring intent in source keeps the author-side story clear and
 * matches Convex's `query(async (ctx, args) => {...})` shape.
 */
import { ulid as ulidRaw } from 'ulid';

import type { Ctx } from '@briven/schema';

type FnOf<TArgs, TOut> = (ctx: Ctx, args: TArgs) => Promise<TOut> | TOut;

export const query = <TArgs, TOut>(fn: FnOf<TArgs, TOut>): FnOf<TArgs, TOut> => fn;
export const mutation = <TArgs, TOut>(fn: FnOf<TArgs, TOut>): FnOf<TArgs, TOut> => fn;
export const action = <TArgs, TOut>(fn: FnOf<TArgs, TOut>): FnOf<TArgs, TOut> => fn;

/**
 * Generate a prefixed, lexicographically-sortable id for a row in one of
 * your own tables, e.g. `ulid('td')` → `'td_01HZ5E4...'`. The prefix is
 * yours to choose (it describes the row type in logs and URLs) — unlike
 * the platform-internal `newId`, which only accepts known system prefixes.
 */
export const ulid = (prefix: string): string => `${prefix}_${ulidRaw()}`;
