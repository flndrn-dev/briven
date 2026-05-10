import { brivenError, mutation, type Ctx } from '@briven/cli/server';
import { ulid } from '@briven/shared';

interface Args {
  roomId: string;
  authorName: string;
  body: string;
}

export default mutation(async (ctx: Ctx, args: Args) => {
  if (!args.roomId)
    throw new brivenError('validation_failed', 'roomId is required', { status: 400 });
  const author = args.authorName?.trim();
  const body = args.body?.trim();
  if (!author)
    throw new brivenError('validation_failed', 'authorName is required', { status: 400 });
  if (!body) throw new brivenError('validation_failed', 'body is required', { status: 400 });
  if (body.length > 2000)
    throw new brivenError('validation_failed', 'body too long (max 2000 chars)', { status: 400 });

  const [room] = await ctx.db('rooms').select(['id']).where({ id: args.roomId }).limit(1);
  if (!room)
    throw new brivenError('not_found', `no room ${args.roomId}`, { status: 404 });

  const id = ulid('msg');
  const [row] = await ctx
    .db('messages')
    .insert({ id, roomId: args.roomId, authorName: author, body })
    .returning();
  return row;
});
