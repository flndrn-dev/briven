import { brivenError, mutation, type Ctx } from '@briven/cli/server';
import { ulid } from '@briven/shared';

interface Args {
  name: string;
}

export default mutation(async (ctx: Ctx, args: Args) => {
  const name = args.name?.trim();
  if (!name) throw new brivenError('validation_failed', 'name is required', { status: 400 });
  if (name.length > 64)
    throw new brivenError('validation_failed', 'name too long (max 64 chars)', { status: 400 });

  const id = ulid('rm');
  const [row] = await ctx.db('rooms').insert({ id, name }).returning();
  return row;
});
