import { mutation, type Ctx } from '@briven/cli/server';

interface Args {
  id?: string;
  by?: number;
}

/**
 * Single-row UPDATE — postgres ON CONFLICT creates the row on first
 * call so we don't need a separate seed mutation. Returns the new
 * count so the client can show optimistic updates if it wants.
 */
export default mutation(async (ctx: Ctx, args: Args) => {
  const id = args.id ?? 'default';
  const by = args.by ?? 1;
  await ctx.db.unsafe(
    `INSERT INTO counters (id, count) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET count = counters.count + EXCLUDED.count`,
    [id, by],
  );
  const [row] = await ctx.db('counters').select(['count']).where({ id }).limit(1);
  return { id, count: Number(row?.count ?? 0) };
});
