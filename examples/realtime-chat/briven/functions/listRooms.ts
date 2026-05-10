import { query, type Ctx } from '@briven/cli/server';

export default query(async (ctx: Ctx) => {
  return ctx
    .db('rooms')
    .select(['id', 'name', 'createdAt'])
    .orderBy('createdAt', 'desc')
    .limit(200);
});
