import type { ColumnDef } from './columns.js';
import type { SchemaDef } from './schema.js';
import type { TableDef } from './table.js';

/**
 * Render a `SchemaDef` to Postgres DDL. Output is idempotent — every
 * statement uses `IF NOT EXISTS` so the CLI can safely run it against a
 * fresh project schema.
 *
 * This function does NOT compute diffs against a deployed schema; that
 * lives in `diff.ts` and consumes the output of `parseInformationSchema`
 * (reserved for a later milestone).
 */
export function generateSql(def: SchemaDef): string {
  const out: string[] = [];
  for (const [name, tableDef] of Object.entries(def.tables)) {
    out.push(renderCreateTable(name, tableDef));
    out.push(...renderIndexes(name, tableDef));
  }
  return out.join('\n\n') + '\n';
}

export function renderCreateTable(name: string, table: TableDef): string {
  const pkColumns = Object.entries(table.columns)
    .filter(([, def]) => def.primaryKey)
    .map(([colName]) => colName);
  // 2+ PK columns → composite key rendered as a table-level constraint.
  // Single PK stays inline on the column for the simpler/expected SQL
  // shape (every existing migration uses the inline form).
  const composite = pkColumns.length > 1;

  const lines: string[] = [];
  for (const [colName, colDef] of Object.entries(table.columns)) {
    lines.push(`  "${colName}" ${renderColumn(colDef, composite)}`);
  }

  if (composite) {
    const colList = pkColumns.map((c) => `"${c}"`).join(', ');
    lines.push(`  PRIMARY KEY (${colList})`);
  }

  const fkLines: string[] = [];
  for (const [colName, colDef] of Object.entries(table.columns)) {
    if (!colDef.references) continue;
    const ref = colDef.references;
    const onDelete = ref.onDelete ? ` ON DELETE ${ref.onDelete.toUpperCase()}` : '';
    fkLines.push(
      `  FOREIGN KEY ("${colName}") REFERENCES "${ref.table}" ("${ref.column}")${onDelete}`,
    );
  }
  lines.push(...fkLines);

  return `CREATE TABLE IF NOT EXISTS "${name}" (\n${lines.join(',\n')}\n);`;
}

function renderColumn(def: ColumnDef, inCompositeKey: boolean): string {
  const parts: string[] = [def.sqlType];
  // Inline PRIMARY KEY only when the table has exactly one PK column;
  // composite keys are emitted as a single constraint at the table level.
  if (def.primaryKey && !inCompositeKey) parts.push('PRIMARY KEY');
  // PK columns are implicitly NOT NULL in Postgres regardless of how
  // the key is declared — keep the existing "skip explicit NOT NULL on
  // PK" behaviour so composite keys produce the same minimal output.
  if (!def.nullable && !def.primaryKey) parts.push('NOT NULL');
  if (def.unique && !def.primaryKey) parts.push('UNIQUE');
  if (def.default !== undefined) parts.push(`DEFAULT ${def.default}`);
  return parts.join(' ');
}

function renderIndexes(tableName: string, table: TableDef): string[] {
  const out: string[] = [];
  for (const idx of table.indexes) {
    const unique = idx.unique ? 'UNIQUE ' : '';
    const colList = idx.columns.map((c) => `"${c}"`).join(', ');
    const nameSuffix = idx.columns.join('_');
    const indexName = `${tableName}_${nameSuffix}_idx`;
    out.push(`CREATE ${unique}INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" (${colList});`);
  }
  return out;
}
