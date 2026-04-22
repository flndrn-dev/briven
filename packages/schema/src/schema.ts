import { isIdentifier, type TableDef } from './table.js';

export interface SchemaDef {
  readonly version: 1;
  readonly tables: Readonly<Record<string, TableDef>>;
}

/**
 * Declare the root schema. Keys are table names as they will appear in
 * Postgres. Per CLAUDE.md §6.1, DB table names are snake_case and plural —
 * we validate identifier shape but leave pluralisation as a user concern.
 */
export function schema(tables: Record<string, TableDef>): SchemaDef {
  const out: Record<string, TableDef> = {};
  for (const [name, def] of Object.entries(tables)) {
    if (!isIdentifier(name)) {
      throw new Error(`invalid table name: ${JSON.stringify(name)}`);
    }
    if (name.startsWith('_briven_')) {
      throw new Error(`table name '${name}' collides with the reserved '_briven_' prefix`);
    }
    out[name] = def;
  }
  return Object.freeze({ version: 1, tables: Object.freeze(out) });
}
