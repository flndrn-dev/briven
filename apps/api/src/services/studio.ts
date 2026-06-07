import { brivenError, ValidationError } from '@briven/shared';
import mysql from 'mysql2/promise';

import { dataPlaneClient, dbNameFor } from '../db/data-plane.js';

/**
 * Studio read-mode services. Migrated from postgres.js to mysql2.
 *
 * @README-BRIVEN Phase 5: migrated from Postgres system catalogs to MySQL
 *   INFORMATION_SCHEMA. Key changes:
 *   - `pg_class`/`pg_namespace` → `INFORMATION_SCHEMA.TABLES`
 *   - `pg_index` → `INFORMATION_SCHEMA.STATISTICS` / `SHOW INDEX`
 *   - `pg_total_relation_size` → `DATA_LENGTH + INDEX_LENGTH` (approximate)
 *   - `SET LOCAL search_path` → `USE database` per connection
 *   - `SET LOCAL ROLE` → removed (MySQL uses connection user)
 *   - `sql` template literals → `conn.query()` with `?` placeholders
 *   - `"..."` identifier quoting → `` `...` ``
 *   - `ILIKE` → `LIKE` (utf8mb4_unicode_ci collation handles case)
 *   - `::text` cast → removed (MySQL is looser with type coercion)
 */

export interface TableSummary {
  readonly name: string;
  readonly approxRowCount: number;
  readonly bytes: number;
}

/** List tables in a project's database. Skips platform-owned `_briven_*` tables. */
export async function listProjectTables(projectId: string): Promise<TableSummary[]> {
  const db = dbNameFor(projectId);
  const conn = await getProjectConn(projectId);
  try {
    const [rows] = await conn.query(
      `SELECT
         TABLE_NAME AS table_name,
         TABLE_ROWS AS reltuples,
         DATA_LENGTH + INDEX_LENGTH AS bytes
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ?
         AND TABLE_TYPE = 'BASE TABLE'
         AND TABLE_NAME NOT LIKE '\\\\_briven\\\\_%'
       ORDER BY TABLE_NAME`,
      [db],
    );
    return (rows as Array<{ table_name: string; reltuples: number; bytes: number }>).map(
      (row) => ({
        name: row.table_name,
        approxRowCount: Number(row.reltuples) || 0,
        bytes: Number(row.bytes) || 0,
      }),
    );
  } finally {
    conn.release();
  }
}

export interface ColumnInfo {
  readonly name: string;
  readonly dataType: string;
  readonly nullable: boolean;
  readonly defaultExpr: string | null;
  readonly ordinalPosition: number;
  readonly isPrimaryKey: boolean;
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
const COLUMN_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

async function assertTableExists(projectId: string, tableName: string): Promise<void> {
  if (!TABLE_NAME_RE.test(tableName)) {
    throw new ValidationError('invalid table name', { tableName });
  }
  if (tableName.startsWith('_briven_')) {
    throw new ValidationError('platform-owned tables are not queryable via studio', { tableName });
  }
  const db = dbNameFor(projectId);
  const conn = await getProjectConn(projectId);
  try {
    const [rows] = await conn.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [db, tableName],
    );
    if ((rows as Array<unknown>).length === 0) {
      throw new brivenError('not_found', `table not found: ${tableName}`, { status: 404 });
    }
  } finally {
    conn.release();
  }
}

/** Get a connection pre-switched to the project's database. */
async function getProjectConn(projectId: string): Promise<mysql.PoolConnection> {
  const pool = dataPlaneClient();
  const conn = await pool.getConnection();
  await conn.query(`USE \`${dbNameFor(projectId)}\``);
  return conn;
}

export async function getTableColumns(
  projectId: string,
  tableName: string,
): Promise<readonly ColumnInfo[]> {
  await assertTableExists(projectId, tableName);
  const db = dbNameFor(projectId);
  const conn = await getProjectConn(projectId);
  try {
    const [pkRows] = await conn.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY'`,
      [db, tableName],
    );
    const pkSet = new Set(
      (pkRows as Array<{ COLUMN_NAME: string }>).map((r) => r.COLUMN_NAME),
    );

    const [fkRows] = await conn.query(
      `SELECT
         kcu.COLUMN_NAME,
         kcu.REFERENCED_TABLE_NAME AS fk_table,
         kcu.REFERENCED_COLUMN_NAME AS fk_column
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
      [db, tableName],
    );
    const fkMap = new Map<string, { table: string; column: string }>();
    for (const r of fkRows as Array<{ COLUMN_NAME: string; fk_table: string; fk_column: string }>) {
      fkMap.set(r.COLUMN_NAME, { table: r.fk_table, column: r.fk_column });
    }

    const [colRows] = await conn.query(
      `SELECT
         COLUMN_NAME,
         DATA_TYPE,
         IS_NULLABLE,
         COLUMN_DEFAULT,
         ORDINAL_POSITION
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [db, tableName],
    );

    return (colRows as Array<{
      COLUMN_NAME: string;
      DATA_TYPE: string;
      IS_NULLABLE: string;
      COLUMN_DEFAULT: string | null;
      ORDINAL_POSITION: number;
    }>).map((row) => ({
      name: row.COLUMN_NAME,
      dataType: row.DATA_TYPE,
      nullable: row.IS_NULLABLE === 'YES',
      defaultExpr: row.COLUMN_DEFAULT,
      ordinalPosition: row.ORDINAL_POSITION,
      isPrimaryKey: pkSet.has(row.COLUMN_NAME),
      references: fkMap.get(row.COLUMN_NAME) ?? null,
    }));
  } finally {
    conn.release();
  }
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export const FILTER_OPS = ['eq', 'contains', 'gt', 'lt', 'gte', 'lte'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

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
      throw new ValidationError('filter column not found on table', { table: tableName, column: col });
    }
    if (!(FILTER_OPS as readonly string[]).includes(op)) {
      throw new ValidationError('invalid filter operator', { op });
    }
    params.push(value);
    const ph = '?';
    switch (op) {
      case 'eq':
        clauses.push(`\`${col}\` = ${ph}`);
        break;
      case 'contains':
        clauses.push(`\`${col}\` LIKE CONCAT('%', ${ph}, '%')`);
        break;
      case 'gt':
        clauses.push(`\`${col}\` > ${ph}`);
        break;
      case 'lt':
        clauses.push(`\`${col}\` < ${ph}`);
        break;
      case 'gte':
        clauses.push(`\`${col}\` >= ${ph}`);
        break;
      case 'lte':
        clauses.push(`\`${col}\` <= ${ph}`);
        break;
    }
  }
  return { clauses, params };
}

export interface RowsOpts {
  readonly limit?: number;
  readonly offset?: number;
  readonly orderBy?: { column: string; direction: 'asc' | 'desc' } | null;
  readonly filters?: ReadonlyArray<{
    column: string;
    op: FilterOp;
    value: string | number | boolean | null;
  }>;
}

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

  let sql = `SELECT * FROM \`${tableName}\``;
  const allParams: unknown[] = [];

  if (opts.filters && opts.filters.length > 0) {
    const { clauses, params } = buildFilterClauses(opts.filters, colNames, tableName);
    if (clauses.length > 0) {
      sql += ` WHERE ${clauses.join(' AND ')}`;
      allParams.push(...params);
    }
  }

  if (opts.orderBy && colNames.has(opts.orderBy.column)) {
    sql += ` ORDER BY \`${opts.orderBy.column}\` ${opts.orderBy.direction.toUpperCase()}`;
  }

  sql += ` LIMIT ${limit + 1} OFFSET ${offset}`;

  const conn = await getProjectConn(projectId);
  try {
    const [rows] = await conn.query(sql, allParams);
    const result = rows as Array<Record<string, unknown>>;
    const hasMore = result.length > limit;
    if (hasMore) result.pop();
    return { columns, rows: result, limit, offset, hasMore };
  } finally {
    conn.release();
  }
}

/* ─── execute arbitrary SQL (Studio query editor) ───────────────── */

export interface QueryResult {
  columns: Array<{ name: string; dataType: string }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  command: string;
  elapsedMs: number;
}

export async function executeQuery(projectId: string, sqlText: string): Promise<QueryResult> {
  if (typeof sqlText !== 'string' || sqlText.trim() === '') {
    throw new ValidationError('sql is required', {});
  }
  if (sqlText.length > 16 * 1024) {
    throw new ValidationError('sql payload too large', { max: 16 * 1024 });
  }

  const conn = await getProjectConn(projectId);
  const t0 = Date.now();

  try {
    const [rows, fields] = await conn.query(sqlText);

    const rowsArr = Array.isArray(rows) ? rows : [];
    const fieldInfo = Array.isArray(fields)
      ? fields.map((f: { name: string }) => ({ name: f.name, dataType: 'unknown' }))
      : [];

    return {
      columns: fieldInfo,
      rows: rowsArr as Array<Record<string, unknown>>,
      rowCount: Array.isArray(rows) ? rows.length : 0,
      command: 'SELECT',
      elapsedMs: Date.now() - t0,
    };
  } finally {
    conn.release();
  }
}

/* ─── schema.ts generator ────────────────────────────────────────── */

function mysqlTypeToDslHelper(mysqlType: string): { helper: string; comment?: string } {
  switch (mysqlType) {
    case 'varchar':
    case 'char':
    case 'text':
    case 'mediumtext':
    case 'longtext':
      return { helper: 'varchar()' };
    case 'int':
    case 'tinyint':
    case 'smallint':
    case 'mediumint':
      return { helper: 'int()' };
    case 'bigint':
      return { helper: 'bigint()' };
    case 'boolean':
    case 'tinyint(1)':
      return { helper: 'boolean()' };
    case 'timestamp':
    case 'datetime':
      return { helper: 'timestamp()' };
    case 'json':
      return { helper: 'json()' };
    case 'float':
    case 'double':
    case 'decimal':
    case 'numeric':
      return { helper: 'numeric()' };
    default:
      return { helper: 'varchar()', comment: `TODO: original type ${mysqlType} — adjust DSL helper` };
  }
}

export async function generateSchemaTs(projectId: string): Promise<string> {
  const tables = await listProjectTables(projectId);
  const lines: string[] = [
    'import { boolean, index, int, json, mysqlTable, text, timestamp, varchar } from "@briven/schema";',
    '',
  ];

  for (const t of tables) {
    const cols = await getTableColumns(projectId, t.name);
    if (cols.length === 0) continue;

    lines.push(`export const ${camelCase(t.name)} = mysqlTable('${t.name}', {`);
    for (const col of cols) {
      const { helper, comment } = mysqlTypeToDslHelper(col.dataType);
      const parts: string[] = [];
      parts.push(`  ${col.name}: ${helper}('${col.name}')`);
      if (!col.nullable) parts.push('.notNull()');
      if (col.isPrimaryKey && col.name === 'id') parts.push('.primaryKey()');
      parts.push(',');
      if (comment) parts.push(` // ${comment}`);
      lines.push(parts.join(''));
    }
    lines.push('}, (t) => ({');
    lines.push('  // TODO: add indexes');
    lines.push('}));');
    lines.push('');
  }

  return lines.join('\n');
}

/* ─── DDL operations ─────────────────────────────────────────────── */

export async function createIndex(
  projectId: string,
  tableName: string,
  columns: readonly string[],
  unique = false,
): Promise<void> {
  await assertTableExists(projectId, tableName);
  const idxName = `idx_${tableName}_${columns.join('_')}`.slice(0, 64);
  const cols = columns.map((c) => `\`${c}\``).join(', ');
  const uniq = unique ? 'UNIQUE' : '';
  const conn = await getProjectConn(projectId);
  try {
    await conn.query(`CREATE ${uniq} INDEX \`${idxName}\` ON \`${tableName}\` (${cols})`);
  } finally {
    conn.release();
  }
}

export async function dropIndex(
  projectId: string,
  tableName: string,
  indexName: string,
): Promise<void> {
  await assertTableExists(projectId, tableName);
  const conn = await getProjectConn(projectId);
  try {
    await conn.query(`DROP INDEX \`${indexName}\` ON \`${tableName}\``);
  } finally {
    conn.release();
  }
}

export async function renameColumn(
  projectId: string,
  tableName: string,
  oldName: string,
  newName: string,
  dataType: string,
): Promise<void> {
  await assertTableExists(projectId, tableName);
  if (oldName === newName) return;
  const conn = await getProjectConn(projectId);
  try {
    await conn.query(
      `ALTER TABLE \`${tableName}\` CHANGE \`${oldName}\` \`${newName}\` ${dataType}`,
    );
  } finally {
    conn.release();
  }
}

export async function setColumnNotNull(
  projectId: string,
  tableName: string,
  columnName: string,
  notNull: boolean,
  dataType: string,
): Promise<void> {
  await assertTableExists(projectId, tableName);
  const modifier = notNull ? 'NOT NULL' : 'NULL';
  const conn = await getProjectConn(projectId);
  try {
    await conn.query(
      `ALTER TABLE \`${tableName}\` MODIFY \`${columnName}\` ${dataType} ${modifier}`,
    );
  } finally {
    conn.release();
  }
}

export async function dropColumn(
  projectId: string,
  tableName: string,
  columnName: string,
): Promise<void> {
  await assertTableExists(projectId, tableName);
  const conn = await getProjectConn(projectId);
  try {
    await conn.query(`ALTER TABLE \`${tableName}\` DROP COLUMN \`${columnName}\``);
  } finally {
    conn.release();
  }
}

export async function deleteRows(
  projectId: string,
  tableName: string,
  primaryKey: Record<string, unknown>,
): Promise<number> {
  await assertTableExists(projectId, tableName);
  const entries = Object.entries(primaryKey);
  if (entries.length === 0) throw new ValidationError('primary key is required', {});
  const where = entries.map(([col]) => `\`${col}\` = ?`).join(' AND ');
  const values = entries.map(([, v]) => v);
  const conn = await getProjectConn(projectId);
  try {
    const [result] = await conn.query(
      `DELETE FROM \`${tableName}\` WHERE ${where}`,
      values,
    );
    return (result as { affectedRows: number }).affectedRows;
  } finally {
    conn.release();
  }
}

/* ─── internal ───────────────────────────────────────────────────── */

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function camelCase(s: string): string {
  return s.replace(/[_-]([a-z])/g, (_, c: string) => c.toUpperCase());
}
