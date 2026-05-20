import { getTableColumns, listProjectTables } from './studio.js';

/**
 * Postgres-schema → briven DSL transcriber.
 *
 * Used by the schema-export route and consumed by the CLI's `existingBranch`
 * flow to pre-populate `briven/schema.ts` from a database the user built by
 * clicking around in studio. The intent is "good-enough first draft" — the
 * generated file is meant to be committed and then hand-edited where the
 * transcribed types are wrong.
 *
 * The pure `exportSchemaToDsl` function takes a plain `ExportInput` shape so
 * tests can exercise the rendering logic without spinning up a live data
 * plane. The DB-coupled wrapper `exportProjectSchema(projectId)` adapts the
 * studio `ColumnInfo` rows into that shape.
 */

interface ExportColumn {
  name: string;
  sqlType: string;
  nullable: boolean;
  primaryKey: boolean;
}

interface ExportTable {
  name: string;
  columns: ExportColumn[];
}

export interface ExportInput {
  tables: ExportTable[];
}

const TYPE_MAP: Record<string, string> = {
  text: 'text()',
  varchar: 'text()',
  uuid: 'text()',
  int4: 'integer()',
  int8: 'bigint()',
  bool: 'boolean()',
  jsonb: 'json()',
  timestamp: 'timestamp()',
  timestamptz: 'timestamp()',
  date: 'date()',
};

function renderColumn(c: ExportColumn): string {
  const base = TYPE_MAP[c.sqlType] ?? null;
  if (!base) {
    return [
      `    // TODO: unsupported type '${c.sqlType}' — confirm`,
      `    ${c.name}: text(),`,
    ].join('\n');
  }
  let chain = base;
  if (c.primaryKey) chain += '.primaryKey()';
  else if (!c.nullable) chain += '.notNull()';
  return `    ${c.name}: ${chain},`;
}

export function exportSchemaToDsl(input: ExportInput): string {
  const importedSymbols = new Set<string>(['schema', 'table']);
  for (const t of input.tables) {
    for (const col of t.columns) {
      const mapped = TYPE_MAP[col.sqlType];
      if (mapped) importedSymbols.add(mapped.replace(/\(\)$/, ''));
      else importedSymbols.add('text');
    }
  }
  const importLine = `import { ${Array.from(importedSymbols).sort().join(', ')} } from '@briven/cli/schema';`;
  const tableLines = input.tables.map((t) => {
    const cols = t.columns.map(renderColumn).join('\n');
    return `  ${t.name}: table({\n${cols}\n  }),`;
  });
  return `${importLine}\n\nexport default schema({\n${tableLines.join('\n')}\n});\n`;
}

export async function exportProjectSchema(projectId: string): Promise<string> {
  const tables = await listProjectTables(projectId);
  const expanded: ExportTable[] = [];
  for (const t of tables) {
    const columns = await getTableColumns(projectId, t.name);
    expanded.push({
      name: t.name,
      // Studio's ColumnInfo uses `dataType` / `nullable` / `isPrimaryKey`.
      // Map onto our DB-free ExportColumn so the pure renderer stays
      // decoupled from the live-DB row shape.
      columns: columns.map((c) => ({
        name: c.name,
        sqlType: c.dataType,
        nullable: c.nullable,
        primaryKey: c.isPrimaryKey,
      })),
    });
  }
  return exportSchemaToDsl({ tables: expanded });
}
