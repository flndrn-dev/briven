import { brivenError, ValidationError } from '@briven/shared';

import { runInProjectDatabase } from '../db/data-plane.js';
import { assertWithinStorageLimit } from './storage-admin.js';

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
  return runInProjectDatabase(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `
      SELECT
        c.relname AS table_name,
        c.reltuples::bigint AS reltuples,
        pg_total_relation_size(c.oid)::bigint AS bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        -- DoltGres lacks the LIKE ... ESCAPE function (errno 1105
        -- 'not_like_escape'), so the _briven_ housekeeping filter uses a
        -- plain prefix compare instead. left()/<> are both supported.
        AND left(c.relname, 8) <> '_briven_'
      ORDER BY c.relname
    `,
    )) as Array<{ table_name: string; reltuples: string | number; bytes: string | number }>;
    return rows.map((row) => ({
      name: row.table_name,
      approxRowCount: Number(row.reltuples) || 0,
      bytes: Number(row.bytes) || 0,
    }));
  });
}

export interface ColumnInfo {
  readonly name: string;
  readonly dataType: string;
  readonly nullable: boolean;
  readonly defaultExpr: string | null;
  readonly ordinalPosition: number;
  /** True if this column participates in the table's primary key. */
  readonly isPrimaryKey: boolean;
  /** If this column is a foreign key, the target table.column. Null otherwise. */
  readonly references: { table: string; column: string } | null;
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
  const row = await runInProjectDatabase(projectId, async (tx) => {
    const [r] = (await tx.unsafe(
      `
      SELECT EXISTS(
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = $1
          AND c.relkind = 'r'
      ) AS exists
    `,
      [tableName],
    )) as Array<{ exists: boolean }>;
    return r;
  });
  if (!row?.exists) {
    throw new brivenError('not_found', `table not found: ${tableName}`, { status: 404 });
  }
}

export async function getTableColumns(
  projectId: string,
  tableName: string,
): Promise<readonly ColumnInfo[]> {
  await assertTableExists(projectId, tableName);
  // Single query: information_schema.columns LEFT JOINed against the
  // table's PK column set, plus a LEFT JOIN against information_schema's FK
  // metadata so each column row can carry its (table.column) reference.
  //
  // PK detection MUST come from information_schema, NOT the pg_index /
  // pg_attribute catalog join (`a.attnum = ANY(i.indkey)`): DoltGres has no
  // `smallint = int2vector` operator and 500s on it ("operator does not exist:
  // smallint = int2vector"). This is the same DoltGres gap S1.4 hit in
  // listIndexes — sourcing PKs from table_constraints + key_column_usage (the
  // exact shape the fk_cols CTE below already uses successfully) avoids it.
  const rows = (await runInProjectDatabase(projectId, async (tx) =>
    tx.unsafe(
      `
    WITH pk_cols AS (
      -- NOTE: the kcu join MUST include table_name. In DoltGres/MySQL every
      -- primary key is named 'PRIMARY', so joining tc→kcu on constraint_name
      -- alone matches the PK column of EVERY table in the schema, fanning out
      -- the column list (e.g. an 'id' PK column appearing once per table that
      -- also has an 'id' PK). DISTINCT is a belt-and-suspenders guard.
      SELECT DISTINCT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
       AND kcu.table_name = tc.table_name
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = $1
    ),
    fk_cols AS (
      SELECT DISTINCT
        kcu.column_name,
        ccu.table_name AS fk_table,
        ccu.column_name AS fk_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
       AND kcu.table_name = tc.table_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = $1
    )
    SELECT
      c.column_name,
      c.data_type,
      c.is_nullable,
      c.column_default,
      c.ordinal_position,
      (pk.column_name IS NOT NULL) AS is_primary_key,
      fk.fk_table,
      fk.fk_column
    FROM information_schema.columns c
    LEFT JOIN pk_cols pk ON pk.column_name = c.column_name
    LEFT JOIN fk_cols fk ON fk.column_name = c.column_name
    WHERE c.table_schema = 'public' AND c.table_name = $1
    ORDER BY c.ordinal_position
  `,
      [tableName],
    ),
  )) as Array<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
    ordinal_position: number;
    is_primary_key: boolean;
    fk_table: string | null;
    fk_column: string | null;
  }>;
  return rows.map((row) => ({
    name: row.column_name,
    dataType: row.data_type,
    nullable: row.is_nullable === 'YES',
    defaultExpr: row.column_default,
    ordinalPosition: row.ordinal_position,
    isPrimaryKey: Boolean(row.is_primary_key),
    references:
      row.fk_table && row.fk_column ? { table: row.fk_table, column: row.fk_column } : null,
  }));
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/** Supported filter operators. Allow-list — anything else returns 400. */
export const FILTER_OPS = ['eq', 'contains', 'gt', 'lt', 'gte', 'lte'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/**
 * Pure WHERE-clause builder. Extracted from `getTableRows` so the SQL
 * shape, identifier validation, operator allow-list, and value-as-param
 * guarantees are unit-testable without a live data plane.
 *
 * Returns `{ clauses, params }` — caller joins with ` AND ` and prefixes
 * `WHERE `. Throws `ValidationError` on bad column name, unknown column,
 * or unknown operator. Values are NEVER inlined — every value is pushed
 * into `params` and referenced as `$N`, so user-supplied strings (e.g.
 * `'; DROP TABLE …`) cannot escape parameterisation.
 */
export function buildFilterClauses(
  filters: ReadonlyArray<{
    column: string;
    op: FilterOp;
    value: string | number | boolean | null;
  }>,
  colNames: ReadonlySet<string>,
  tableName: string,
): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  for (const { column: col, op, value } of filters) {
    if (!COLUMN_NAME_RE.test(col)) {
      throw new ValidationError('invalid filter column', { column: col });
    }
    if (!colNames.has(col)) {
      throw new ValidationError('filter column not found on table', {
        table: tableName,
        column: col,
      });
    }
    if (!(FILTER_OPS as readonly string[]).includes(op)) {
      throw new ValidationError('invalid filter operator', { op });
    }
    params.push(value);
    const placeholder = `$${params.length}`;
    switch (op) {
      case 'eq':
        clauses.push(`"${col}" = ${placeholder}`);
        break;
      case 'contains':
        // DoltGres has no ILIKE, so `lower(col) LIKE lower(value)` gives the
        // same case-insensitive substring match. The placeholder is wrapped
        // server-side so callers can't smuggle pattern characters by writing
        // `%foo%` themselves — `'%' || lower($N) || '%'` parameterises the
        // literal value with `%` glued in SQL, not in the input.
        clauses.push(`lower("${col}"::text) LIKE '%' || lower(${placeholder}) || '%'`);
        break;
      case 'gt':
        clauses.push(`"${col}" > ${placeholder}`);
        break;
      case 'lt':
        clauses.push(`"${col}" < ${placeholder}`);
        break;
      case 'gte':
        clauses.push(`"${col}" >= ${placeholder}`);
        break;
      case 'lte':
        clauses.push(`"${col}" <= ${placeholder}`);
        break;
    }
  }
  return { clauses, params };
}

export interface RowsOpts {
  readonly limit?: number;
  readonly offset?: number;
  readonly orderBy?: { column: string; direction: 'asc' | 'desc' } | null;
  /** Filter clauses with operators. Order is preserved in WHERE generation. */
  readonly filters?: ReadonlyArray<{
    column: string;
    op: FilterOp;
    value: string | number | boolean | null;
  }>;
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
  const columns = await getTableColumns(projectId, tableName);
  const colNames = new Set(columns.map((c) => c.name));

  const { clauses: filterClauses, params } = buildFilterClauses(
    opts.filters ?? [],
    colNames,
    tableName,
  );
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

  const rows = (await runInProjectDatabase(projectId, async (tx) =>
    tx.unsafe(
      `SELECT * FROM "${tableName}" ${where} ${orderBy} ${limitOffset}`.replace(/\s+/g, ' ').trim(),
      params as never[],
    ),
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

/**
 * One {column, value} pair for matching a row by primary key. For
 * single-PK tables this is a length-1 array; for composite-keyed tables
 * (M2M, time-series with natural keys) it's length-N. The service
 * enforces that the caller-provided column set EXACTLY matches the
 * table's PK column set — a partial PK would silently match many rows.
 */
export interface PrimaryKeyValue {
  readonly column: string;
  readonly value: string | number;
}

export interface UpdateCellInput {
  readonly projectId: string;
  readonly tableName: string;
  readonly primaryKey: ReadonlyArray<PrimaryKeyValue>;
  readonly column: string;
  /** Already-typed JS value. The data plane casts via parameter binding. */
  readonly value: unknown;
}

export interface UpdateCellResult {
  readonly affected: number;
}

function assertPrimaryKeyMatches(
  cols: ReadonlyArray<{ name: string; isPrimaryKey: boolean }>,
  pk: ReadonlyArray<PrimaryKeyValue>,
): void {
  if (pk.length === 0) {
    throw new ValidationError('primary key array must not be empty', {});
  }
  for (const pair of pk) {
    if (!COLUMN_NAME_RE.test(pair.column)) {
      throw new ValidationError('invalid primary-key column', { column: pair.column });
    }
  }
  const callerSet = new Set(pk.map((p) => p.column));
  if (callerSet.size !== pk.length) {
    throw new ValidationError('duplicate primary-key column in request', {});
  }
  const tablePkSet = new Set(cols.filter((c) => c.isPrimaryKey).map((c) => c.name));
  if (tablePkSet.size === 0) {
    throw new ValidationError('table has no primary key — inline edits disabled', {});
  }
  if (tablePkSet.size !== callerSet.size) {
    throw new ValidationError(
      `primary-key column count mismatch — table has ${tablePkSet.size}, request has ${callerSet.size}`,
      {},
    );
  }
  for (const name of callerSet) {
    if (!tablePkSet.has(name)) {
      throw new ValidationError("primary-key column doesn't match the table's pk", {
        column: name,
      });
    }
  }
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
 *  - requires the primary-key array to match the table's pk EXACTLY —
 *    a partial PK on a composite-keyed table would silently match many
 *    rows and clobber every one
 */
export async function updateCell(input: UpdateCellInput): Promise<UpdateCellResult> {
  await assertTableExists(input.projectId, input.tableName);
  if (!COLUMN_NAME_RE.test(input.column)) {
    throw new ValidationError('invalid column name', { column: input.column });
  }
  const cols = await getTableColumns(input.projectId, input.tableName);
  if (!cols.find((c) => c.name === input.column)) {
    throw new ValidationError('column not found on table', {
      table: input.tableName,
      column: input.column,
    });
  }
  assertPrimaryKeyMatches(cols, input.primaryKey);

  // Param positions: $1 is the SET value, $2..$N+1 are the WHERE clauses.
  // Building the WHERE this way keeps every identifier inside backticks
  // and every value parameter-bound.
  const whereSql = input.primaryKey
    .map((p, i) => `"${p.column}" = $${i + 2}`)
    .join(' AND ');
  const params: ReadonlyArray<never> = [
    input.value as never,
    ...input.primaryKey.map((p) => p.value as never),
  ];
  // The pg ProjectTx adapter returns the rows array (not a result object with
  // `.count`), so `RETURNING 1` lets us recover the affected-row count.
  const rows = await runInProjectDatabase(input.projectId, async (tx) => {
    await tx.unsafe('SET dolt_transaction_commit = 1');
    return tx.unsafe(
      `UPDATE "${input.tableName}" SET "${input.column}" = $1 WHERE ${whereSql} RETURNING 1`,
      params as unknown as never[],
    );
  });
  return { affected: rows.length };
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

  // Phase 4: in 'block' mode, reject the write when the project is at its row
  // cap. No-op fast path for 'flag' projects (the default) — no count runs.
  await assertWithinStorageLimit(input.projectId, 'row');

  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const cols_sql = keys.map((k) => `"${k}"`).join(', ');
  const params = keys.map((k) => input.values[k] as never);
  const rows = (await runInProjectDatabase(input.projectId, async (tx) => {
    await tx.unsafe('SET dolt_transaction_commit = 1');
    return tx.unsafe(
      `INSERT INTO "${input.tableName}" (${cols_sql}) VALUES (${placeholders}) RETURNING *`,
      params,
    );
  })) as Array<Record<string, unknown>>;
  return { inserted: rows[0] ?? null };
}

/**
 * Hard ceiling on a single table export. Sized to comfortably cover a Pro
 * project's row counts while keeping the in-memory accumulation bounded so a
 * huge table can't OOM the api. When exceeded, the export is truncated and the
 * `truncated` flag is set so the UI can tell the user there's more.
 */
export const MAX_EXPORT_ROWS = 100_000;

/**
 * Hard ceiling on a single CSV/JSON import. Keeps one upload bounded; bigger
 * loads should use the CLI / SDK. Each row inserts in its own Dolt commit so a
 * bad row is skipped, not fatal — see bulkImportRows.
 */
export const MAX_IMPORT_ROWS = 10_000;

export interface TableExport {
  readonly columns: readonly ColumnInfo[];
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  /** True when the table has more rows than MAX_EXPORT_ROWS (export cut off). */
  readonly truncated: boolean;
}

/**
 * Read every row of a table for download. Pages through the proven
 * `getTableRows` path (same DoltGres-safe SELECT, same isolation) rather than
 * issuing a new unbounded query — so the export inherits the data-plane
 * boundary and the `_briven_` guard for free. Caps at MAX_EXPORT_ROWS.
 */
export async function exportAllTableRows(
  projectId: string,
  tableName: string,
): Promise<TableExport> {
  await assertTableExists(projectId, tableName);
  const columns = await getTableColumns(projectId, tableName);
  const all: Array<Record<string, unknown>> = [];
  let offset = 0;
  for (;;) {
    const page = await getTableRows(projectId, tableName, { limit: MAX_LIMIT, offset });
    all.push(...page.rows);
    if (all.length >= MAX_EXPORT_ROWS) {
      return { columns, rows: all.slice(0, MAX_EXPORT_ROWS), truncated: true };
    }
    if (!page.hasMore || page.rows.length === 0) break;
    offset += page.rows.length;
  }
  return { columns, rows: all, truncated: false };
}

export interface BulkImportInput {
  readonly projectId: string;
  readonly tableName: string;
  /** Each entry is one row's column→value map; keys validated per row. */
  readonly rows: ReadonlyArray<Record<string, unknown>>;
}

export interface BulkImportResult {
  readonly inserted: number;
  readonly failed: number;
  /** First 100 per-row failures (row index + reason); UI surfaces them. */
  readonly errors: ReadonlyArray<{ row: number; message: string }>;
}

/**
 * Insert many rows from a CSV/JSON upload. Each row is inserted independently
 * (its own Dolt commit) so one malformed row is skipped and reported rather
 * than failing the whole batch — the spec'd "skip bad rows, tell me which"
 * behaviour. Columns are fetched ONCE and validated in-memory per row (no
 * N+1 metadata queries). Reuses the exact parameterised INSERT shape that
 * `insertRow` is proven on against DoltGres.
 */
export async function bulkImportRows(input: BulkImportInput): Promise<BulkImportResult> {
  await assertTableExists(input.projectId, input.tableName);
  if (input.rows.length === 0) {
    throw new ValidationError('import requires at least one row', {});
  }
  if (input.rows.length > MAX_IMPORT_ROWS) {
    throw new ValidationError(`import is capped at ${MAX_IMPORT_ROWS} rows per upload`, {
      rows: input.rows.length,
      max: MAX_IMPORT_ROWS,
    });
  }
  const cols = await getTableColumns(input.projectId, input.tableName);
  const colNames = new Set(cols.map((c) => c.name));
  // Block-mode row-cap gate, once. Flag-mode projects (default) no-op here.
  await assertWithinStorageLimit(input.projectId, 'row');

  let inserted = 0;
  const errors: Array<{ row: number; message: string }> = [];
  for (let i = 0; i < input.rows.length; i++) {
    const values = input.rows[i] ?? {};
    const keys = Object.keys(values);
    try {
      if (keys.length === 0) {
        throw new ValidationError('row has no columns', {});
      }
      for (const k of keys) {
        if (!COLUMN_NAME_RE.test(k)) {
          throw new ValidationError('invalid column name', { column: k });
        }
        if (!colNames.has(k)) {
          throw new ValidationError(`column not found on table: ${k}`, { column: k });
        }
      }
      const placeholders = keys.map((_, j) => `$${j + 1}`).join(', ');
      const cols_sql = keys.map((k) => `"${k}"`).join(', ');
      const params = keys.map((k) => values[k] as never);
      await runInProjectDatabase(input.projectId, async (tx) => {
        await tx.unsafe('SET dolt_transaction_commit = 1');
        return tx.unsafe(
          `INSERT INTO "${input.tableName}" (${cols_sql}) VALUES (${placeholders})`,
          params,
        );
      });
      inserted++;
    } catch (err) {
      if (errors.length < 100) {
        errors.push({ row: i, message: err instanceof Error ? err.message : 'insert failed' });
      }
    }
  }
  return { inserted, failed: input.rows.length - inserted, errors };
}

export interface DeleteRowInput {
  readonly projectId: string;
  readonly tableName: string;
  readonly primaryKey: ReadonlyArray<PrimaryKeyValue>;
}

export interface DeleteRowResult {
  readonly affected: number;
}

export interface QueryResult {
  readonly columns: ReadonlyArray<{ name: string; dataType: string }>;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly rowCount: number;
  readonly command: string;
  readonly elapsedMs: number;
}

/**
 * Run an arbitrary SQL statement against the project's OWN DoltGres database.
 * Isolation now comes from the database boundary itself — the connection is
 * bound to `proj_<id>`, so the user can only ever touch their own tables (the
 * legacy per-project SET LOCAL ROLE scoping is obsolete in the
 * database-per-project model).
 *
 *  - bound to the project's own database (public schema) by the connection
 *    itself — no search_path pinning needed (DoltGres has no SET LOCAL)
 *  - transactional via `runInProjectDatabase`: rolls back if the statement
 *    errors, and `dolt_transaction_commit` makes the COMMIT a real Dolt commit
 *    for any writes
 *  - audit-logged by the route handler (sql text + elapsed)
 *
 * NB: trusting the user with their own data is fine; this lets them DROP
 * their own tables if they want to.
 */
export async function executeQuery(projectId: string, sqlText: string): Promise<QueryResult> {
  if (typeof sqlText !== 'string' || sqlText.trim() === '') {
    throw new ValidationError('sql is required', {});
  }
  if (sqlText.length > 16 * 1024) {
    throw new ValidationError('sql payload too large', { max: 16 * 1024 });
  }
  const t0 = Date.now();

  // `runInProjectDatabase` opens one BEGIN/COMMIT transaction on a connection
  // bound to the project's own database. `dolt_transaction_commit = 1` is the
  // first statement so any write the user runs becomes a real Dolt commit
  // (mirrors apps/runtime/src/db.ts:withProjectTx).
  const out = (await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe('SET dolt_transaction_commit = 1');
    // No SET LOCAL: DoltGres doesn't support it, and the connection is already
    // bound to the project's own database (public schema), so search_path
    // pinning is unnecessary. statement_timeout isn't enforceable here.
    const result = (await tx.unsafe(sqlText)) as Array<Record<string, unknown>>;
    const rows = Array.isArray(result) ? [...result] : [];
    const first = rows[0];
    return {
      rows,
      // The pg ProjectTx adapter returns only the rows array — there is no
      // `.count`/`.command`/`.columns` like postgres.js exposed. Derive what
      // we can: row count and column names from the first row's keys.
      count: rows.length,
      command: 'UNKNOWN',
      columns: first ? Object.keys(first).map((name) => ({ name })) : [],
    };
  })) as {
    rows: Array<Record<string, unknown>>;
    count: number;
    command: string;
    columns: Array<{ name: string; type?: number }>;
  };

  const elapsedMs = Date.now() - t0;

  // We don't have a cheap type-name lookup here. Surface the column name and
  // leave dataType as 'unknown' so the UI can still render a table. Future
  // slice: join against pg_type.
  const columns = out.columns.map((c) => ({ name: c.name, dataType: 'unknown' }));

  return {
    columns,
    rows: out.rows,
    rowCount: out.count,
    command: out.command,
    elapsedMs,
  };
}

/**
 * Map a postgres `data_type` (information_schema flavour) onto the briven
 * schema-DSL helper name. Best-effort — anything outside the known list
 * is emitted as a TODO comment so the user can fix it by hand.
 */
function pgTypeToDslHelper(pgType: string): { helper: string; comment?: string } {
  switch (pgType) {
    case 'text':
    case 'character varying':
    case 'varchar':
      return { helper: 'text()' };
    case 'integer':
    case 'int4':
      return { helper: 'integer()' };
    case 'bigint':
    case 'int8':
      return { helper: 'bigint()' };
    case 'boolean':
      return { helper: 'boolean()' };
    case 'timestamp with time zone':
    case 'timestamp without time zone':
    case 'timestamp':
    case 'timestamptz':
      return { helper: 'timestamp()' };
    case 'jsonb':
      return { helper: 'jsonb()' };
    case 'uuid':
      return { helper: 'uuid()' };
    case 'numeric':
    case 'decimal':
      return { helper: 'numeric()' };
    default:
      return { helper: 'text()', comment: `TODO: original type ${pgType} — adjust DSL helper` };
  }
}

/**
 * Generate an equivalent `briven/schema.ts` for the entire project. Used by
 * the dashboard's "copy as schema.ts" affordance so a database the user
 * built by clicking around in studio can be committed to git and managed
 * via the CLI from then on.
 */
export async function exportSchemaAsDsl(projectId: string): Promise<string> {
  const tables = await listProjectTables(projectId);
  if (tables.length === 0) {
    return [
      "import { schema, table } from '@briven/cli/schema';",
      '',
      '// no tables yet — create one from the dashboard or define it here.',
      'export default schema({});',
      '',
    ].join('\n');
  }
  const tableNames = tables.map((t) => t.name);
  const perTable = await Promise.all(
    tableNames.map(async (t) => ({ table: t, columns: await getTableColumns(projectId, t) })),
  );

  // Collect every helper actually used so the import line stays minimal.
  const helpersUsed = new Set<string>();
  helpersUsed.add('schema');
  helpersUsed.add('table');

  const lines: string[] = [];
  for (const { table: tName, columns } of perTable) {
    lines.push(`  ${tName}: table({`);
    for (const col of columns) {
      const { helper, comment } = pgTypeToDslHelper(col.dataType);
      const helperName = helper.replace(/\(\)$/, '');
      helpersUsed.add(helperName);
      const modifiers: string[] = [];
      if (col.isPrimaryKey) modifiers.push('.primaryKey()');
      if (!col.nullable && !col.isPrimaryKey) modifiers.push('.notNull()');
      if (col.defaultExpr) {
        // Single-quote the default for the DSL — it accepts a raw expression.
        modifiers.push(`.default(${JSON.stringify(col.defaultExpr)})`);
      }
      if (col.references) {
        modifiers.push(`.references('${col.references.table}', '${col.references.column}')`);
      }
      const commentSuffix = comment ? ` // ${comment}` : '';
      lines.push(`    ${col.name}: ${helper}${modifiers.join('')},${commentSuffix}`);
    }
    lines.push('  }),');
  }

  const helpersList = Array.from(helpersUsed).sort();
  return [
    `import { ${helpersList.join(', ')} } from '@briven/cli/schema';`,
    '',
    '// generated from the live database by briven studio.',
    "// commit this file and run `briven deploy` to keep the schema in git.",
    'export default schema({',
    ...lines,
    '});',
    '',
  ].join('\n');
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

export interface StudioColumnReference {
  readonly table: string;
  readonly column: string;
  /** `cascade` | `restrict` | `setNull` | `noAction` — defaults to `noAction`. */
  readonly onDelete?: 'cascade' | 'restrict' | 'setNull' | 'noAction';
}

export interface StudioColumnSpec {
  readonly name: string;
  readonly type: StudioColumnType;
  readonly notNull?: boolean;
  readonly primaryKey?: boolean;
  /** Raw SQL default expression — e.g. `'now()'`, `'gen_random_uuid()'`, `'0'`. */
  readonly defaultExpr?: string | null;
  /** Optional foreign-key target. Same schema only. */
  readonly references?: StudioColumnReference | null;
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
  if (spec.references) {
    if (!TABLE_NAME_RE.test(spec.references.table)) {
      throw new ValidationError('invalid referenced table name', {
        table: spec.references.table,
      });
    }
    if (!COLUMN_NAME_RE.test(spec.references.column)) {
      throw new ValidationError('invalid referenced column name', {
        column: spec.references.column,
      });
    }
  }
}

const ON_DELETE_SQL: Record<NonNullable<StudioColumnReference['onDelete']>, string> = {
  cascade: 'CASCADE',
  restrict: 'RESTRICT',
  setNull: 'SET NULL',
  noAction: 'NO ACTION',
};

function columnDdl(
  spec: StudioColumnSpec,
  opts: { suppressInlinePk?: boolean } = {},
): string {
  const parts = [`"${spec.name}" ${spec.type}`];
  // For composite PKs, the inline PRIMARY KEY is suppressed — a single
  // table-level PRIMARY KEY (col, col) constraint is emitted by the
  // caller instead. NOT NULL is implicit on PK columns in Postgres so
  // the existing "skip explicit NOT NULL when PK" behaviour stays right
  // whether the key is inline or composite.
  if (spec.primaryKey && !opts.suppressInlinePk) parts.push('PRIMARY KEY');
  if (spec.notNull && !spec.primaryKey) parts.push('NOT NULL');
  if (spec.defaultExpr != null && spec.defaultExpr !== '') {
    parts.push(`DEFAULT ${spec.defaultExpr}`);
  }
  if (spec.references) {
    // FK target lives in the same project database — unqualified identifier
    // resolves to `public`, so no schema prefix is needed.
    const onDelete = ON_DELETE_SQL[spec.references.onDelete ?? 'noAction'];
    parts.push(
      `REFERENCES "${spec.references.table}" ("${spec.references.column}") ON DELETE ${onDelete}`,
    );
  }
  return parts.join(' ');
}

async function assertFkTarget(
  projectId: string,
  ref: StudioColumnReference,
  selfTable: string,
): Promise<void> {
  // Self-reference is allowed (e.g. parent_id on comments) — skip the
  // existence probe so brand-new tables can FK to themselves.
  if (ref.table === selfTable) return;
  const row = await runInProjectDatabase(projectId, async (tx) => {
    const [r] = (await tx.unsafe(
      `
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
      ) AS exists
    `,
      [ref.table, ref.column],
    )) as Array<{ exists: boolean }>;
    return r;
  });
  if (!row?.exists) {
    throw new ValidationError('referenced table.column does not exist', {
      table: ref.table,
      column: ref.column,
    });
  }
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

  for (const col of input.columns) {
    if (col.references) {
      await assertFkTarget(input.projectId, col.references, input.tableName);
    }
  }

  // Phase 4: in 'block' mode, reject when the project is at its table cap.
  // No-op fast path for 'flag' projects (the default).
  await assertWithinStorageLimit(input.projectId, 'table');

  // Composite PK → table-level constraint; single PK stays inline so the
  // SQL output is unchanged for every non-M2M shape.
  const isComposite = pkCount > 1;
  const colsSql = input.columns
    .map((c) => columnDdl(c, { suppressInlinePk: isComposite }))
    .join(', ');
  const pkClause = isComposite
    ? `, PRIMARY KEY (${input.columns
        .filter((c) => c.primaryKey)
        .map((c) => `"${c.name}"`)
        .join(', ')})`
    : '';
  await runInProjectDatabase(input.projectId, async (tx) => {
    await tx.unsafe('SET dolt_transaction_commit = 1');
    await tx.unsafe(`CREATE TABLE "${input.tableName}" (${colsSql}${pkClause})`);
  });
  return { name: input.tableName };
}

/**
 * Drop a table (cascade off — refuses if FKs point at it, so callers get
 * a clear error rather than nuking dependent data silently).
 */
export async function dropTable(projectId: string, tableName: string): Promise<void> {
  await assertTableExists(projectId, tableName);
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe('SET dolt_transaction_commit = 1');
    await tx.unsafe(`DROP TABLE "${tableName}"`);
  });
}

/**
 * TRUNCATE a table — wipes every row but keeps the schema. DoltGres does not
 * support `RESTART IDENTITY` (no serial sequences) nor `CASCADE`, so neither
 * is emitted; cascade=true is rejected with a clear error rather than sent as
 * SQL DoltGres can't run.
 */
export async function truncateTable(
  projectId: string,
  tableName: string,
  cascade = false,
): Promise<void> {
  await assertTableExists(projectId, tableName);
  if (cascade) {
    throw new ValidationError('TRUNCATE CASCADE is not supported on DoltGres', {});
  }
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe('SET dolt_transaction_commit = 1');
    await tx.unsafe(`TRUNCATE TABLE "${tableName}"`);
  });
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
  if (input.column.references) {
    await assertFkTarget(input.projectId, input.column.references, input.tableName);
  }
  await runInProjectDatabase(input.projectId, async (tx) => {
    await tx.unsafe('SET dolt_transaction_commit = 1');
    await tx.unsafe(
      `ALTER TABLE "${input.tableName}" ADD COLUMN ${columnDdl(input.column)}`,
    );
  });
}

export interface RelationshipEdge {
  /** Table holding the FK column. */
  readonly fromTable: string;
  readonly fromColumn: string;
  /** Table the FK points at. */
  readonly toTable: string;
  readonly toColumn: string;
}

/**
 * Every foreign-key edge in the project's schema. Drives the studio
 * overview's "relationships" panel so users can see the shape of their
 * data model at a glance.
 */
export interface FullSchemaTable {
  readonly name: string;
  readonly columns: readonly ColumnInfo[];
}

export interface FullSchema {
  readonly tables: readonly FullSchemaTable[];
  readonly relationships: readonly RelationshipEdge[];
}

/**
 * One-shot read of every table + its columns + every FK edge. Drives the
 * "schema overview" page so users see the entire data model in one place
 * without paginating through each table individually.
 *
 * Single information_schema sweep — no per-table round-trip.
 */
export async function getFullSchema(projectId: string): Promise<FullSchema> {
  const tables = await listProjectTables(projectId);
  const perTable = await Promise.all(
    tables.map(async (t) => ({
      name: t.name,
      columns: await getTableColumns(projectId, t.name),
    })),
  );
  const relationships = await listRelationships(projectId);
  return { tables: perTable, relationships };
}

export async function listRelationships(projectId: string): Promise<readonly RelationshipEdge[]> {
  const rows = (await runInProjectDatabase(projectId, async (tx) =>
    tx.unsafe(`
    SELECT
      tc.table_name AS from_table,
      kcu.column_name AS from_column,
      ccu.table_name AS to_table,
      ccu.column_name AS to_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name
  `),
  )) as Array<{
    from_table: string;
    from_column: string;
    to_table: string;
    to_column: string;
  }>;
  return rows.map((r) => ({
    fromTable: r.from_table,
    fromColumn: r.from_column,
    toTable: r.to_table,
    toColumn: r.to_column,
  }));
}

export interface IndexSummary {
  /** Index name as it lives in pg_class. */
  readonly name: string;
  /** Ordered list of column names participating in the index. */
  readonly columns: readonly string[];
  /** True if the index was created with UNIQUE. */
  readonly unique: boolean;
  /** True if this is the table's primary-key index — never droppable from studio. */
  readonly isPrimary: boolean;
}

const INDEX_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/**
 * Every index on a table — primary, unique, and plain. Used by the schema
 * panel so the user can see what's already indexed before adding more.
 */
export async function listIndexes(
  projectId: string,
  tableName: string,
): Promise<readonly IndexSummary[]> {
  await assertTableExists(projectId, tableName);
  // DoltGres rejects the pg_index/array_position introspection join
  // ("operator does not exist: smallint = int2vector"). information_schema.
  // statistics IS supported (MySQL-heritage view) and gives one row per
  // (index, column) with order + uniqueness. The primary key surfaces as the
  // synthetic name 'PRIMARY'. NB: DoltGres returns these column keys in
  // UPPERCASE, so we read each row case-insensitively.
  const rawRows = (await runInProjectDatabase(projectId, async (tx) =>
    tx.unsafe(
      `
    SELECT index_name, column_name, seq_in_index, non_unique
    FROM information_schema.statistics
    WHERE table_schema = 'public'
      AND table_name = $1
    ORDER BY index_name, seq_in_index
  `,
      [tableName],
    ),
  )) as Array<Record<string, unknown>>;

  // Normalise UPPER/lower key casing into a predictable shape.
  const pick = (row: Record<string, unknown>, key: string): unknown =>
    row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()];

  // Group the per-column rows into one entry per index, preserving column order.
  const byIndex = new Map<string, { columns: string[]; unique: boolean; isPrimary: boolean }>();
  for (const row of rawRows) {
    const indexName = String(pick(row, 'index_name'));
    const columnName = String(pick(row, 'column_name'));
    const nonUnique = Number(pick(row, 'non_unique')) === 1;
    let entry = byIndex.get(indexName);
    if (!entry) {
      entry = { columns: [], unique: !nonUnique, isPrimary: indexName === 'PRIMARY' };
      byIndex.set(indexName, entry);
    }
    entry.columns.push(columnName);
  }

  const summaries: IndexSummary[] = Array.from(byIndex.entries()).map(([name, e]) => ({
    name,
    columns: e.columns,
    unique: e.unique,
    isPrimary: e.isPrimary,
  }));
  // Primary key first, then the rest by name — matches the previous ordering.
  return summaries.sort((a, b) =>
    a.isPrimary === b.isPrimary ? a.name.localeCompare(b.name) : a.isPrimary ? -1 : 1,
  );
}

export interface CreateIndexInput {
  readonly projectId: string;
  readonly tableName: string;
  readonly columns: readonly string[];
  readonly unique?: boolean;
  /** Optional explicit index name. Defaults to `<table>_<cols>_idx`. */
  readonly name?: string | null;
}

/**
 * Create an index on one or more columns. Refuses platform-owned tables
 * (via assertTableExists) and validates every column identifier against
 * the actual column set.
 */
export async function createIndex(input: CreateIndexInput): Promise<{ name: string }> {
  await assertTableExists(input.projectId, input.tableName);
  if (input.columns.length === 0) {
    throw new ValidationError('an index needs at least one column', {});
  }
  const cols = await getTableColumns(input.projectId, input.tableName);
  const colNames = new Set(cols.map((c) => c.name));
  for (const col of input.columns) {
    if (!COLUMN_NAME_RE.test(col)) {
      throw new ValidationError('invalid column name', { column: col });
    }
    if (!colNames.has(col)) {
      throw new ValidationError('column not found on table', {
        table: input.tableName,
        column: col,
      });
    }
  }

  const indexName =
    input.name ??
    `${input.tableName}_${input.columns.join('_')}_idx`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 63);
  if (!INDEX_NAME_RE.test(indexName)) {
    throw new ValidationError('invalid index name', { name: indexName });
  }

  const uniqueClause = input.unique ? 'UNIQUE' : '';
  const colsList = input.columns.map((c) => `"${c}"`).join(', ');
  await runInProjectDatabase(input.projectId, async (tx) => {
    await tx.unsafe('SET dolt_transaction_commit = 1');
    await tx.unsafe(
      `CREATE ${uniqueClause} INDEX "${indexName}" ON "${input.tableName}" (${colsList})`,
    );
  });
  return { name: indexName };
}

/**
 * Drop an index by name. Refuses the primary-key index (which would
 * invalidate row-level operations) — that has to go via dropping the
 * column or the table.
 */
export async function dropIndex(
  projectId: string,
  tableName: string,
  indexName: string,
): Promise<void> {
  await assertTableExists(projectId, tableName);
  if (!INDEX_NAME_RE.test(indexName)) {
    throw new ValidationError('invalid index name', { name: indexName });
  }
  const all = await listIndexes(projectId, tableName);
  const target = all.find((i) => i.name === indexName);
  if (!target) {
    throw new ValidationError('index not found on table', { table: tableName, index: indexName });
  }
  if (target.isPrimary) {
    throw new ValidationError('cannot drop the primary-key index', { index: indexName });
  }
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe('SET dolt_transaction_commit = 1');
    await tx.unsafe(`DROP INDEX "${indexName}"`);
  });
}

/**
 * Rename a table. Refuses platform-owned `_briven_*` tables (source name)
 * and refuses to rename into the platform-owned prefix (target name).
 */
export async function renameTable(args: {
  projectId: string;
  oldName: string;
  newName: string;
}): Promise<void> {
  await assertTableExists(args.projectId, args.oldName);
  if (!TABLE_NAME_RE.test(args.newName)) {
    throw new ValidationError('invalid new table name', { newName: args.newName });
  }
  if (args.newName.startsWith('_briven_')) {
    throw new ValidationError('platform-owned table prefix is reserved', {
      newName: args.newName,
    });
  }
  if (args.oldName === args.newName) return;
  await runInProjectDatabase(args.projectId, async (tx) => {
    await tx.unsafe('SET dolt_transaction_commit = 1');
    await tx.unsafe(`ALTER TABLE "${args.oldName}" RENAME TO "${args.newName}"`);
  });
}

/**
 * Rename a column on a table. PK / FK / index references survive
 * automatically — Postgres rewrites them by oid.
 */
export async function renameColumn(args: {
  projectId: string;
  tableName: string;
  oldName: string;
  newName: string;
}): Promise<void> {
  await assertTableExists(args.projectId, args.tableName);
  if (!COLUMN_NAME_RE.test(args.oldName)) {
    throw new ValidationError('invalid old column name', { oldName: args.oldName });
  }
  if (!COLUMN_NAME_RE.test(args.newName)) {
    throw new ValidationError('invalid new column name', { newName: args.newName });
  }
  if (args.oldName === args.newName) return;
  const cols = await getTableColumns(args.projectId, args.tableName);
  if (!cols.find((c) => c.name === args.oldName)) {
    throw new ValidationError('column not found on table', {
      table: args.tableName,
      column: args.oldName,
    });
  }
  if (cols.find((c) => c.name === args.newName)) {
    throw new ValidationError('a column with the new name already exists', {
      newName: args.newName,
    });
  }
  await runInProjectDatabase(args.projectId, async (tx) => {
    await tx.unsafe('SET dolt_transaction_commit = 1');
    await tx.unsafe(
      `ALTER TABLE "${args.tableName}" RENAME COLUMN "${args.oldName}" TO "${args.newName}"`,
    );
  });
}

export interface AlterColumnInput {
  readonly projectId: string;
  readonly tableName: string;
  readonly column: string;
  /** Set to true to make NOT NULL; false to drop NOT NULL. */
  readonly notNull?: boolean;
  /**
   * Default expression. Pass `null` to drop the default. Pass a string to
   * set it. Omit to leave alone.
   */
  readonly defaultExpr?: string | null;
}

/**
 * Change a column's nullability + default. Refuses to alter a PK column's
 * nullability (PKs are implicitly NOT NULL) and validates the default
 * expression against the same regex as create-column.
 */
export async function alterColumn(input: AlterColumnInput): Promise<void> {
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
  if (target.isPrimaryKey && typeof input.notNull === 'boolean') {
    throw new ValidationError('cannot change nullability of a primary-key column', {
      column: input.column,
    });
  }
  if (
    input.defaultExpr !== undefined
    && input.defaultExpr !== null
    && !DEFAULT_EXPR_RE.test(input.defaultExpr)
  ) {
    throw new ValidationError('default expression contains disallowed characters', {
      column: input.column,
    });
  }

  await runInProjectDatabase(input.projectId, async (tx) => {
    await tx.unsafe('SET dolt_transaction_commit = 1');
    if (typeof input.notNull === 'boolean' && input.notNull !== !target.nullable) {
      const clause = input.notNull ? 'SET NOT NULL' : 'DROP NOT NULL';
      await tx.unsafe(
        `ALTER TABLE "${input.tableName}" ALTER COLUMN "${input.column}" ${clause}`,
      );
    }
    if (input.defaultExpr === null && target.defaultExpr !== null) {
      await tx.unsafe(
        `ALTER TABLE "${input.tableName}" ALTER COLUMN "${input.column}" DROP DEFAULT`,
      );
    } else if (typeof input.defaultExpr === 'string' && input.defaultExpr !== '') {
      await tx.unsafe(
        `ALTER TABLE "${input.tableName}" ALTER COLUMN "${input.column}" SET DEFAULT ${input.defaultExpr}`,
      );
    }
  });
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
  await runInProjectDatabase(input.projectId, async (tx) => {
    await tx.unsafe('SET dolt_transaction_commit = 1');
    await tx.unsafe(`ALTER TABLE "${input.tableName}" DROP COLUMN "${input.column}"`);
  });
}

/**
 * Delete one row by primary key. Validates the table + pk-column
 * identifiers against the project's schema; parameterises the row-key.
 * Refuses to touch platform-owned `_briven_*` tables (caught by
 * `assertTableExists`).
 */
export async function deleteRow(input: DeleteRowInput): Promise<DeleteRowResult> {
  await assertTableExists(input.projectId, input.tableName);
  const cols = await getTableColumns(input.projectId, input.tableName);
  assertPrimaryKeyMatches(cols, input.primaryKey);

  const whereSql = input.primaryKey
    .map((p, i) => `"${p.column}" = $${i + 1}`)
    .join(' AND ');
  const params: ReadonlyArray<never> = input.primaryKey.map((p) => p.value as never);
  // The pg ProjectTx adapter returns the rows array (not a result object with
  // `.count`), so `RETURNING 1` lets us recover the affected-row count.
  const rows = await runInProjectDatabase(input.projectId, async (tx) => {
    await tx.unsafe('SET dolt_transaction_commit = 1');
    return tx.unsafe(
      `DELETE FROM "${input.tableName}" WHERE ${whereSql} RETURNING 1`,
      params as unknown as never[],
    );
  });
  return { affected: rows.length };
}
