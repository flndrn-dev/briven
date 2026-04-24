/**
 * Identity-function wrappers that document intent on the author side
 * and give us a future enforcement hook (e.g. read-only transactions
 * on `query`). The runtime infers query/mutation/action from where
 * the file lives on disk today, not from these wrappers — but
 * declaring intent in source keeps the author-side story clear and
 * matches Convex's `query(async (ctx, args) => {...})` shape.
 */
import type { Ctx } from '@briven/schema';

type FnOf<TArgs, TOut> = (ctx: Ctx, args: TArgs) => Promise<TOut> | TOut;

export const query = <TArgs, TOut>(fn: FnOf<TArgs, TOut>): FnOf<TArgs, TOut> => fn;
export const mutation = <TArgs, TOut>(fn: FnOf<TArgs, TOut>): FnOf<TArgs, TOut> => fn;
export const action = <TArgs, TOut>(fn: FnOf<TArgs, TOut>): FnOf<TArgs, TOut> => fn;
