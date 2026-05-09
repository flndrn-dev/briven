import type { SchemaDef } from './schema.js';
import type { TableDef } from './table.js';

export type Change =
  | { kind: 'create_table'; table: string; def: TableDef }
  | { kind: 'drop_table'; table: string }
  | { kind: 'add_column'; table: string; column: string; def: TableDef['columns'][string] }
  | { kind: 'drop_column'; table: string; column: string };

export interface DiffResult {
  readonly changes: readonly Change[];
  readonly destructive: boolean;
}

/**
 * Compute the set of changes to go from `prev` to `next`.
 *
 * Phase 1 scope is deliberately narrow: add/drop tables and add/drop
 * columns. It does not yet detect column-type changes, index changes,
 * or default-value updates — those land alongside the migration runner
 * in Phase 2 per BUILD_PLAN.md.
 */
export function diff(prev: SchemaDef | null, next: SchemaDef): DiffResult {
  const changes: Change[] = [];
  const prevTables = prev?.tables ?? {};

  for (const [name, def] of Object.entries(next.tables)) {
    const existing = prevTables[name];
    if (!existing) {
      changes.push({ kind: 'create_table', table: name, def });
      continue;
    }
    for (const [colName, colDef] of Object.entries(def.columns)) {
      if (!(colName in existing.columns)) {
        changes.push({ kind: 'add_column', table: name, column: colName, def: colDef });
      }
    }
    for (const colName of Object.keys(existing.columns)) {
      if (!(colName in def.columns)) {
        changes.push({ kind: 'drop_column', table: name, column: colName });
      }
    }
  }

  for (const name of Object.keys(prevTables)) {
    if (!(name in next.tables)) {
      changes.push({ kind: 'drop_table', table: name });
    }
  }

  const destructive = changes.some((c) => c.kind === 'drop_table' || c.kind === 'drop_column');
  return { changes, destructive };
}

export function summariseDiff(result: DiffResult): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of result.changes) {
    counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  }
  return counts;
}
