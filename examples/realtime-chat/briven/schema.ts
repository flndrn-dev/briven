import { schema, table, text, timestamp } from '@briven/cli/schema';

export default schema({
  rooms: table({
    id: text().primaryKey(),
    name: text().notNull(),
    createdAt: timestamp().default('now()').notNull(),
  }),
  messages: table({
    id: text().primaryKey(),
    roomId: text().notNull(),
    authorName: text().notNull(),
    body: text().notNull(),
    createdAt: timestamp().default('now()').notNull(),
  }),
});
