import { query, type Ctx } from '@briven/cli/server';

interface Args {
  id?: string;
}

/**
 * Reactive query — returns the current count for the named counter.
 * A missing row is treated as 0 so the first subscriber doesn't need
 * to seed the counters table first.
 */
export default query(async (ctx: Ctx, args: Args) => {
  const id = args.id ?? 'default';
  const [row] = await ctx.db('counters').select(['count']).where({ id }).limit(1);
  return { id, count: row ? Number(row.count) : 0 };
});
