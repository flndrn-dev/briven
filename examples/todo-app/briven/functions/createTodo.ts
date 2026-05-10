import { brivenError, mutation, type Ctx } from '@briven/cli/server';
import { ulid } from '@briven/shared';

interface Args {
  body: string;
}

export default mutation(async (ctx: Ctx, args: Args) => {
  const body = args.body?.trim();
  if (!body) throw new brivenError('validation_failed', 'body is required', { status: 400 });
  if (body.length > 280)
    throw new brivenError('validation_failed', 'body too long (max 280 chars)', { status: 400 });

  const id = ulid('td');
  const [row] = await ctx
    .db('todos')
    .insert({ id, body, done: false })
    .returning();
  return row;
});
