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
  const lines: string[] = [];
  for (const [colName, colDef] of Object.entries(table.columns)) {
    lines.push(`  "${colName}" ${renderColumn(colDef)}`);
  }

  const fkLines: string[] = [];
  for (const [colName, colDef] of Object.entries(table.columns)) {
    if (!colDef.references) continue;
    const ref = colDef.references;
    const onDelete = ref.onDelete
      ? ` ON DELETE ${ref.onDelete.toUpperCase()}`
      : '';
    fkLines.push(
      `  FOREIGN KEY ("${colName}") REFERENCES "${ref.table}" ("${ref.column}")${onDelete}`,
    );
  }
  lines.push(...fkLines);

  return `CREATE TABLE IF NOT EXISTS "${name}" (\n${lines.join(',\n')}\n);`;
}

function renderColumn(def: ColumnDef): string {
  const parts: string[] = [def.sqlType];
  if (def.primaryKey) parts.push('PRIMARY KEY');
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
    out.push(
      `CREATE ${unique}INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" (${colList});`,
    );
  }
  return out;
}
