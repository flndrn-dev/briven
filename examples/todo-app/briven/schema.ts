import { boolean, schema, table, text, timestamp } from '@briven/cli/schema';

export default schema({
  todos: table({
    id: text().primaryKey(),
    body: text().notNull(),
    done: boolean().default(false).notNull(),
    createdAt: timestamp().default('now()').notNull(),
    completedAt: timestamp().nullable(),
  }),
});
