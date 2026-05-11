import { bigint, schema, table, text } from '@briven/cli/schema';

/**
 * Single-row counter — the minimum-viable briven app. One table with
 * one row, no foreign keys, no indexes. Increment runs in a single
 * UPDATE; every subscriber sees the new count via LISTEN/NOTIFY.
 */
export default schema({
  counters: table({
    id: text().primaryKey(),
    count: bigint().default(0n).notNull(),
  }),
});
