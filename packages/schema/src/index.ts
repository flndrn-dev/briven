/**
 * @briven/schema — schema DSL + SQL generation for briven projects.
 *
 * Users declare their project's Postgres schema with this package:
 *
 *   import { schema, table, text, timestamp } from '@briven/schema';
 *
 *   export default schema({
 *     notes: table({
 *       id: text().primaryKey(),
 *       body: text().notNull(),
 *       createdAt: timestamp().default('now()').notNull(),
 *     }),
 *   });
 *
 * `@briven/cli` bundles the user's schema module, calls `generateSql()`
 * and `diff()` to plan a migration, and ships the result to
 * `apps/api` / the shard worker for transactional application.
 */

export { ColumnBuilder } from './columns.js';
export type { ColumnDef, OnDelete } from './columns.js';
export {
  bigint,
  boolean,
  integer,
  jsonb,
  text,
  timestamp,
  uuid,
  varchar,
  vector,
} from './columns.js';

export { table, isIdentifier } from './table.js';
export type { AccessRules, IndexDef, TableDef, TableInput } from './table.js';

export { schema } from './schema.js';
export type { SchemaDef } from './schema.js';

export { generateSql, renderCreateTable } from './sql.js';
export { diff, summariseDiff } from './diff.js';
export type { Change, DiffResult } from './diff.js';

export type {
  AuthContext,
  Ctx,
  DbClient,
  DeleteQuery,
  InsertQuery,
  Logger,
  SelectQuery,
  TableQuery,
  UpdateQuery,
} from './ctx.js';
