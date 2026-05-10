import { brivenError, mutation, type Ctx } from '@briven/cli/server';

interface Args {
  id: string;
}

export default mutation(async (ctx: Ctx, args: Args) => {
  if (!args.id) throw new brivenError('validation_failed', 'id is required', { status: 400 });
  const [existing] = await ctx.db('todos').select(['id', 'done']).where({ id: args.id }).limit(1);
  if (!existing) throw new brivenError('not_found', `no todo ${args.id}`, { status: 404 });

  const next = !existing.done;
  await ctx
    .db('todos')
    .update({ done: next, completedAt: next ? new Date().toISOString() : null })
    .where({ id: args.id });

  return { id: args.id, done: next };
});
