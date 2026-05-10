import { brivenError, mutation, type Ctx } from '@briven/cli/server';

interface Args {
  id: string;
}

export default mutation(async (ctx: Ctx, args: Args) => {
  if (!args.id) throw new brivenError('validation_failed', 'id is required', { status: 400 });
  const affected = await ctx.db('todos').delete().where({ id: args.id });
  if (affected === 0) throw new brivenError('not_found', `no todo ${args.id}`, { status: 404 });
  return { id: args.id, deleted: true };
});
