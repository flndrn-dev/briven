import { brivenError, ValidationError } from '@briven/shared';

import { dataPlaneClient, schemaNameFor } from '../db/data-plane.js';

/**
 * Studio read-mode services. Phase 2 first slice — table listing only.
 *
 * Future slices:
 *  - rows-per-table (paginated)
 *  - column metadata (types, nullability, defaults) for a tables-detail view
 *  - inline edit (write mode) — gated on RLS-style guard rails the runtime
 *    enforces; never exposed without an admin-tier session
 */

export interface TableSummary {
  /** Table name (stripped of schema qualifier — `notes`, not `proj_xxx.notes`). */
  readonly name: string;
  /** Approximate row count via `pg_class.reltuples` — fast, slightly stale. */
  readonly approxRowCount: number;
  /** Total relation size on disk (bytes), including indexes + toast. */
  readonly bytes: number;
}

/**
 * Lists tables in a project's data-plane schema. Skips the platform-owned
 * `_briven_*` tables — those are bookkeeping the customer never edits.
 *
 * Approx row count comes from pg_class.reltuples which is updated by
 * autovacuum; fast (single index lookup) but can lag a recently-bulk-
 * inserted table by ~30s. Acceptable for a dashboard summary; if a
 * future view needs exact counts it can issue `count(*)` per table.
 */
export async function listProjectTables(projectId: string): Promise<TableSummary[]> {
  const schema = schemaNameFor(projectId);
  const sql = dataPlaneClient();
  const rows = (await sql<
    Array<{ table_name: string; reltuples: number; bytes: number }>
  >`
    SELECT
      c.relname AS table_name,
      c.reltuples::bigint AS reltuples,
      pg_total_relation_size(c.oid)::bigint AS bytes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${schema}
      AND c.relkind = 'r'
      AND c.relname NOT LIKE '\\_briven\\_%' ESCAPE '\\'
    ORDER BY c.relname
  `) as Array<{ table_name: string; reltuples: string | number; bytes: string | number }>;
  return rows.map((row) => ({
    name: row.table_name,
    approxRowCount: Number(row.reltuples) || 0,
    bytes: Number(row.bytes) || 0,
  }));
}

export interface ColumnInfo {
  readonly name: string;
  readonly dataType: string;
  readonly nullable: boolean;
  readonly defaultExpr: string | null;
  readonly ordinalPosition: number;
  /** True if this column participates in the table's primary key. */
  readonly isPrimaryKey: boolean;
}

export interface TableRows {
  readonly columns: readonly ColumnInfo[];
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

const TABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/**
 * Validate that a table name is a real table in the project's schema.
 * The regex blocks SQL-injection via the table identifier; the existence
 * check is the actual defence against cross-schema reads — only tables
 * present in the project's `pg_namespace` will ever be queried.
 */
async function assertTableExists(projectId: string, tableName: string): Promise<void> {
  if (!TABLE_NAME_RE.test(tableName)) {
    throw new ValidationError('invalid table name', { tableName });
  }
  if (tableName.startsWith('_briven_')) {
    throw new ValidationError('platform-owned tables are not queryable via studio', {
      tableName,
    });
  }
  const schema = schemaNameFor(projectId);
  const sql = dataPlaneClient();
  const [row] = await sql<Array<{ exists: boolean }>>`
    SELECT EXISTS(
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schema}
        AND c.relname = ${tableName}
        AND c.relkind = 'r'
    ) AS exists
  `;
  if (!row?.exists) {
    throw new brivenError('not_found', `table not found: ${tableName}`, { status: 404 });
  }
}

export async function getTableColumns(
  projectId: string,
  tableName: string,
): Promise<readonly ColumnInfo[]> {
  await assertTableExists(projectId, tableName);
  const schema = schemaNameFor(projectId);
  const sql = dataPlaneClient();
  // Single query: information_schema.columns LEFT JOINed against the
  // table's PK column set sourced from pg_index. The LATERAL join
  // produces one row per column with a boolean for PK membership.
  const rows = (await sql<
    Array<{
      column_name: string;
      data_type: string;
      is_nullable: 'YES' | 'NO';
      column_default: string | null;
      ordinal_position: number;
      is_primary_key: boolean;
    }>
  >`
    WITH pk_cols AS (
      SELECT a.attname AS column_name
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
      WHERE i.indisprimary
        AND n.nspname = ${schema}
        AND c.relname = ${tableName}
    )
    SELECT
      c.column_name,
      c.data_type,
      c.is_nullable,
      c.column_default,
      c.ordinal_position,
      (pk.column_name IS NOT NULL) AS is_primary_key
    FROM information_schema.columns c
    LEFT JOIN pk_cols pk ON pk.column_name = c.column_name
    WHERE c.table_schema = ${schema} AND c.table_name = ${tableName}
    ORDER BY c.ordinal_position
  `) as Array<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
    ordinal_position: number;
    is_primary_key: boolean;
  }>;
  return rows.map((row) => ({
    name: row.column_name,
    dataType: row.data_type,
    nullable: row.is_nullable === 'YES',
    defaultExpr: row.column_default,
    ordinalPosition: row.ordinal_position,
    isPrimaryKey: Boolean(row.is_primary_key),
  }));
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export interface RowsOpts {
  readonly limit?: number;
  readonly offset?: number;
  readonly orderBy?: { column: string; direction: 'asc' | 'desc' } | null;
  /** Equality filters: `{ column: value }`. Each value is parameterised. */
  readonly filters?: Record<string, string | number | boolean | null>;
}

/**
 * Paginated table contents. Identifier interpolation is gated by
 * `assertTableExists` — we never accept a raw table name without
 * confirming it's in the project's schema. Limit/offset/orderBy/filter
 * column names are validated against the actual columns set; values
 * pass through `sql.unsafe`'s parameterisation, never string concat.
 *
 * Pulls one extra row to detect `hasMore` without a separate `count(*)`
 * — counting a 10M-row table would dominate the request.
 */
export async function getTableRows(
  projectId: string,
  tableName: string,
  opts: RowsOpts = {},
): Promise<TableRows> {
  await assertTableExists(projectId, tableName);
  const limit = clamp(opts.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = Math.max(0, opts.offset ?? 0);
  const schema = schemaNameFor(projectId);
  const columns = await getTableColumns(projectId, tableName);
  const colNames = new Set(columns.map((c) => c.name));

  // Build WHERE — parameterised values, validated identifiers.
  const filterClauses: string[] = [];
  const params: unknown[] = [];
  if (opts.filters) {
    for (const [col, value] of Object.entries(opts.filters)) {
      if (!COLUMN_NAME_RE.test(col)) {
        throw new ValidationError('invalid filter column', { column: col });
      }
      if (!colNames.has(col)) {
        throw new ValidationError('filter column not found on table', {
          table: tableName,
          column: col,
        });
      }
      params.push(value);
      filterClauses.push(`"${col}" = $${params.length}`);
    }
  }
  const where = filterClauses.length > 0 ? `WHERE ${filterClauses.join(' AND ')}` : '';

  // Build ORDER BY — validated identifier, fixed-set direction.
  let orderBy = '';
  if (opts.orderBy) {
    if (!COLUMN_NAME_RE.test(opts.orderBy.column)) {
      throw new ValidationError('invalid order-by column', { column: opts.orderBy.column });
    }
    if (!colNames.has(opts.orderBy.column)) {
      throw new ValidationError('order-by column not found on table', {
        table: tableName,
        column: opts.orderBy.column,
      });
    }
    const dir = opts.orderBy.direction === 'desc' ? 'DESC' : 'ASC';
    orderBy = `ORDER BY "${opts.orderBy.column}" ${dir}`;
  }

  // limit + offset are appended as the last two parameters.
  params.push(limit + 1);
  params.push(offset);
  const limitOffset = `LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const sql = dataPlaneClient();
  const rows = (await sql.unsafe(
    `SELECT * FROM "${schema}"."${tableName}" ${where} ${orderBy} ${limitOffset}`.replace(/\s+/g, ' ').trim(),
    params as never[],
  )) as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;
  return { columns, rows: trimmed, limit, offset, hasMore };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return Math.floor(n);
}

const COLUMN_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export interface UpdateCellInput {
  readonly projectId: string;
  readonly tableName: string;
  readonly primaryKeyColumn: string;
  readonly primaryKeyValue: string | number;
  readonly column: string;
  /** Already-typed JS value. The data plane casts via parameter binding. */
  readonly value: unknown;
}

export interface UpdateCellResult {
  readonly affected: number;
}

/**
 * Update a single cell on a single row. Admin-tier guarded at the route
 * layer; this service additionally:
 *
 *  - validates the table + column identifiers against existence in the
 *    project's schema (no SQL injection through identifiers)
 *  - refuses to touch platform-owned `_briven_*` tables
 *  - parameterises the row-key + the new value so the only thing
 *    interpolated is the verified table/column name
 */
export async function updateCell(input: UpdateCellInput): Promise<UpdateCellResult> {
  await assertTableExists(input.projectId, input.tableName);
  if (!COLUMN_NAME_RE.test(input.column)) {
    throw new ValidationError('invalid column name', { column: input.column });
  }
  if (!COLUMN_NAME_RE.test(input.primaryKeyColumn)) {
    throw new ValidationError('invalid primary-key column', {
      primaryKeyColumn: input.primaryKeyColumn,
    });
  }
  const cols = await getTableColumns(input.projectId, input.tableName);
  if (!cols.find((c) => c.name === input.column)) {
    throw new ValidationError('column not found on table', {
      table: input.tableName,
      column: input.column,
    });
  }
  if (!cols.find((c) => c.name === input.primaryKeyColumn)) {
    throw new ValidationError('primary-key column not found on table', {
      table: input.tableName,
      primaryKeyColumn: input.primaryKeyColumn,
    });
  }
  const schema = schemaNameFor(input.projectId);
  const sql = dataPlaneClient();
  const result = (await sql.unsafe(
    `UPDATE "${schema}"."${input.tableName}" SET "${input.column}" = $1 WHERE "${input.primaryKeyColumn}" = $2`,
    [input.value as never, input.primaryKeyValue as never],
  )) as { count?: number } & ReadonlyArray<unknown>;
  return { affected: typeof result.count === 'number' ? result.count : 0 };
}

export interface InsertRowInput {
  readonly projectId: string;
  readonly tableName: string;
  /** Column → value. Every key is validated against the actual schema. */
  readonly values: Record<string, unknown>;
}

export interface InsertRowResult {
  readonly inserted: Record<string, unknown> | null;
}

/**
 * Insert one row, returning the row as the database stored it (with
 * defaults filled in). Validates that every key in `values` is a real
 * column on the table. Builds a parameterised INSERT — the only things
 * interpolated are the verified schema/table/column identifiers.
 */
export async function insertRow(input: InsertRowInput): Promise<InsertRowResult> {
  await assertTableExists(input.projectId, input.tableName);
  const cols = await getTableColumns(input.projectId, input.tableName);
  const colNames = new Set(cols.map((c) => c.name));
  const keys = Object.keys(input.values);
  for (const k of keys) {
    if (!COLUMN_NAME_RE.test(k)) {
      throw new ValidationError('invalid column name', { column: k });
    }
    if (!colNames.has(k)) {
      throw new ValidationError('column not found on table', {
        table: input.tableName,
        column: k,
      });
    }
  }
  if (keys.length === 0) {
    throw new ValidationError('insert requires at least one column', {});
  }

  const schema = schemaNameFor(input.projectId);
  const sql = dataPlaneClient();
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const cols_sql = keys.map((k) => `"${k}"`).join(', ');
  const params = keys.map((k) => input.values[k] as never);
  const rows = (await sql.unsafe(
    `INSERT INTO "${schema}"."${input.tableName}" (${cols_sql}) VALUES (${placeholders}) RETURNING *`,
    params,
  )) as Array<Record<string, unknown>>;
  return { inserted: rows[0] ?? null };
}

export interface DeleteRowInput {
  readonly projectId: string;
  readonly tableName: string;
  readonly primaryKeyColumn: string;
  readonly primaryKeyValue: string | number;
}

export interface DeleteRowResult {
  readonly affected: number;
}

/**
 * Studio-supported column type vocabulary. Keep this list short — exotic
 * types (arrays, enums, ranges) still work via the CLI schema.ts path. The
 * names map 1:1 onto the actual postgres type a CREATE/ALTER statement uses.
 */
export const STUDIO_COLUMN_TYPES = [
  'text',
  'integer',
  'bigint',
  'boolean',
  'timestamptz',
  'jsonb',
  'uuid',
  'numeric',
] as const;
export type StudioColumnType = (typeof STUDIO_COLUMN_TYPES)[number];

export interface StudioColumnSpec {
  readonly name: string;
  readonly type: StudioColumnType;
  readonly notNull?: boolean;
  readonly primaryKey?: boolean;
  /** Raw SQL default expression — e.g. `'now()'`, `'gen_random_uuid()'`, `'0'`. */
  readonly defaultExpr?: string | null;
}

export interface CreateTableInput {
  readonly projectId: string;
  readonly tableName: string;
  readonly columns: readonly StudioColumnSpec[];
}

const DEFAULT_EXPR_RE = /^[A-Za-z0-9_().,:\s'"\-+/*]{1,200}$/;

function assertColumnSpec(spec: StudioColumnSpec): void {
  if (!COLUMN_NAME_RE.test(spec.name)) {
    throw new ValidationError('invalid column name', { column: spec.name });
  }
  if (!STUDIO_COLUMN_TYPES.includes(spec.type)) {
    throw new ValidationError('unsupported column type', {
      type: spec.type,
      supported: STUDIO_COLUMN_TYPES.join(','),
    });
  }
  if (spec.defaultExpr != null && !DEFAULT_EXPR_RE.test(spec.defaultExpr)) {
    throw new ValidationError('default expression contains disallowed characters', {
      column: spec.name,
    });
  }
}

function columnDdl(spec: StudioColumnSpec): string {
  const parts = [`"${spec.name}" ${spec.type}`];
  if (spec.primaryKey) parts.push('PRIMARY KEY');
  if (spec.notNull && !spec.primaryKey) parts.push('NOT NULL');
  if (spec.defaultExpr != null && spec.defaultExpr !== '') {
    parts.push(`DEFAULT ${spec.defaultExpr}`);
  }
  return parts.join(' ');
}

/**
 * Create a new table in the project's schema. Refuses platform-owned
 * `_briven_*` names, enforces the studio type whitelist on every column,
 * and demands at least one primary-key column so the row-edit path keeps
 * working downstream.
 */
export async function createTable(input: CreateTableInput): Promise<{ name: string }> {
  if (!TABLE_NAME_RE.test(input.tableName)) {
    throw new ValidationError('invalid table name', { tableName: input.tableName });
  }
  if (input.tableName.startsWith('_briven_')) {
    throw new ValidationError('platform-owned table prefix is reserved', {
      tableName: input.tableName,
    });
  }
  if (input.columns.length === 0) {
    throw new ValidationError('a table needs at least one column', {});
  }
  const seen = new Set<string>();
  let pkCount = 0;
  for (const col of input.columns) {
    assertColumnSpec(col);
    if (seen.has(col.name)) {
      throw new ValidationError('duplicate column name', { column: col.name });
    }
    seen.add(col.name);
    if (col.primaryKey) pkCount++;
  }
  if (pkCount === 0) {
    throw new ValidationError('one column must be marked primaryKey', {});
  }
  if (pkCount > 1) {
    // Composite PKs work but the studio row-edit path assumes a single-column
    // PK today — reject until that's lifted.
    throw new ValidationError('composite primary keys are not supported via studio yet', {});
  }

  const schema = schemaNameFor(input.projectId);
  const sql = dataPlaneClient();
  const colsSql = input.columns.map(columnDdl).join(', ');
  await sql.unsafe(`CREATE TABLE "${schema}"."${input.tableName}" (${colsSql})`);
  return { name: input.tableName };
}

/**
 * Drop a table (cascade off — refuses if FKs point at it, so callers get
 * a clear error rather than nuking dependent data silently).
 */
export async function dropTable(projectId: string, tableName: string): Promise<void> {
  await assertTableExists(projectId, tableName);
  const schema = schemaNameFor(projectId);
  const sql = dataPlaneClient();
  await sql.unsafe(`DROP TABLE "${schema}"."${tableName}"`);
}

/**
 * Add a column to an existing table. Same type whitelist + default-expr
 * regex as createTable.
 */
export async function addColumn(input: {
  projectId: string;
  tableName: string;
  column: StudioColumnSpec;
}): Promise<void> {
  await assertTableExists(input.projectId, input.tableName);
  assertColumnSpec(input.column);
  if (input.column.primaryKey) {
    throw new ValidationError('cannot add a primary-key column to an existing table via studio', {});
  }
  const cols = await getTableColumns(input.projectId, input.tableName);
  if (cols.find((c) => c.name === input.column.name)) {
    throw new ValidationError('column already exists', { column: input.column.name });
  }
  const schema = schemaNameFor(input.projectId);
  const sql = dataPlaneClient();
  await sql.unsafe(
    `ALTER TABLE "${schema}"."${input.tableName}" ADD COLUMN ${columnDdl(input.column)}`,
  );
}

/**
 * Drop a column. Refuses to drop a PK column — that would invalidate every
 * row-level operation in studio and is almost always a mistake.
 */
export async function dropColumn(input: {
  projectId: string;
  tableName: string;
  column: string;
}): Promise<void> {
  await assertTableExists(input.projectId, input.tableName);
  if (!COLUMN_NAME_RE.test(input.column)) {
    throw new ValidationError('invalid column name', { column: input.column });
  }
  const cols = await getTableColumns(input.projectId, input.tableName);
  const target = cols.find((c) => c.name === input.column);
  if (!target) {
    throw new ValidationError('column not found on table', {
      table: input.tableName,
      column: input.column,
    });
  }
  if (target.isPrimaryKey) {
    throw new ValidationError('cannot drop a primary-key column', { column: input.column });
  }
  const schema = schemaNameFor(input.projectId);
  const sql = dataPlaneClient();
  await sql.unsafe(`ALTER TABLE "${schema}"."${input.tableName}" DROP COLUMN "${input.column}"`);
}

/**
 * Delete one row by primary key. Validates the table + pk-column
 * identifiers against the project's schema; parameterises the row-key.
 * Refuses to touch platform-owned `_briven_*` tables (caught by
 * `assertTableExists`).
 */
export async function deleteRow(input: DeleteRowInput): Promise<DeleteRowResult> {
  await assertTableExists(input.projectId, input.tableName);
  if (!COLUMN_NAME_RE.test(input.primaryKeyColumn)) {
    throw new ValidationError('invalid primary-key column', {
      primaryKeyColumn: input.primaryKeyColumn,
    });
  }
  const cols = await getTableColumns(input.projectId, input.tableName);
  if (!cols.find((c) => c.name === input.primaryKeyColumn)) {
    throw new ValidationError('primary-key column not found on table', {
      table: input.tableName,
      primaryKeyColumn: input.primaryKeyColumn,
    });
  }
  const schema = schemaNameFor(input.projectId);
  const sql = dataPlaneClient();
  const result = (await sql.unsafe(
    `DELETE FROM "${schema}"."${input.tableName}" WHERE "${input.primaryKeyColumn}" = $1`,
    [input.primaryKeyValue as never],
  )) as { count?: number } & ReadonlyArray<unknown>;
  return { affected: typeof result.count === 'number' ? result.count : 0 };
}
