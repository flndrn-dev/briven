import { ColumnBuilder, type ColumnDef } from './columns.js';

export interface IndexDef {
  readonly columns: readonly string[];
  readonly unique: boolean;
}

export interface AccessRules {
  readonly read?: string;
  readonly write?: string;
}

export interface TableDef {
  readonly columns: Readonly<Record<string, ColumnDef>>;
  readonly indexes: readonly IndexDef[];
  readonly access?: AccessRules;
}

export interface TableInput {
  columns: Record<string, ColumnBuilder>;
  indexes?: Array<{ columns: readonly string[]; unique?: boolean }>;
  access?: AccessRules;
}

/**
 * Declare a table. The `columns` record is the core input; `indexes` and
 * `access` are optional refinements. The returned value is an immutable
 * `TableDef` suitable for serialisation.
 */
export function table(input: TableInput | Record<string, ColumnBuilder>): TableDef {
  const normalised: TableInput = isTableInput(input)
    ? input
    : { columns: input };

  const columns: Record<string, ColumnDef> = {};
  for (const [name, builder] of Object.entries(normalised.columns)) {
    if (!isIdentifier(name)) {
      throw new Error(`invalid column name: ${JSON.stringify(name)}`);
    }
    columns[name] = builder.def;
  }

  // Exactly one primary key per table.
  const primaryKeys = Object.values(columns).filter((c) => c.primaryKey);
  if (primaryKeys.length === 0) {
    throw new Error('table requires exactly one primaryKey() column');
  }
  if (primaryKeys.length > 1) {
    throw new Error('table has more than one primary key; composite keys are not yet supported');
  }

  const indexes: IndexDef[] = (normalised.indexes ?? []).map((idx) => {
    for (const col of idx.columns) {
      if (!(col in columns)) {
        throw new Error(`index references unknown column '${col}'`);
      }
    }
    return { columns: [...idx.columns], unique: idx.unique ?? false };
  });

  return Object.freeze({
    columns: Object.freeze(columns),
    indexes: Object.freeze(indexes),
    access: normalised.access,
  });
}

function isTableInput(v: unknown): v is TableInput {
  return (
    typeof v === 'object' &&
    v !== null &&
    'columns' in v &&
    typeof (v as { columns: unknown }).columns === 'object'
  );
}

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/**
 * Permissive identifier check — allows camelCase and snake_case so authors
 * can stay idiomatic in TypeScript while also matching CLAUDE.md §6.1's
 * snake_case recommendation where they prefer. The SQL renderer quotes
 * identifiers exactly as given.
 */
export function isIdentifier(s: string): boolean {
  return IDENTIFIER_RE.test(s);
}
