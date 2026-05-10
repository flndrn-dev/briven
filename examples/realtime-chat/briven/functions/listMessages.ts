import { brivenError, query, type Ctx } from '@briven/cli/server';

interface Args {
  roomId: string;
  limit?: number;
}

export default query(async (ctx: Ctx, args: Args) => {
  if (!args.roomId)
    throw new brivenError('validation_failed', 'roomId is required', { status: 400 });

  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  return ctx
    .db('messages')
    .select(['id', 'roomId', 'authorName', 'body', 'createdAt'])
    .where({ roomId: args.roomId })
    .orderBy('createdAt', 'desc')
    .limit(limit);
});
