import { query, type Ctx } from '@briven/cli/server';

interface Args {
  filter?: 'open' | 'done' | 'all';
}

export default query(async (ctx: Ctx, args: Args = {}) => {
  let q = ctx.db('todos').select(['id', 'body', 'done', 'createdAt', 'completedAt']);
  if (args.filter === 'open') q = q.where({ done: false });
  if (args.filter === 'done') q = q.where({ done: true });
  return q.orderBy('createdAt', 'desc').limit(200);
});
