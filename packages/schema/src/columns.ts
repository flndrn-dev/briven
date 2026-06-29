/**
 * Column builders. Each builder is immutable — every chained call
 * (.notNull(), .primaryKey(), .default(), .references(), .unique())
 * returns a new builder rather than mutating the previous one. This lets
 * users store and reuse intermediate builders without surprise.
 */

export type OnDelete = 'cascade' | 'set null' | 'restrict';

export interface ColumnDef {
  readonly sqlType: string;
  readonly nullable: boolean;
  readonly primaryKey: boolean;
  readonly unique: boolean;
  readonly default?: string;
  readonly references?: {
    readonly table: string;
    readonly column: string;
    readonly onDelete?: OnDelete;
  };
}

export class ColumnBuilder<TDef extends ColumnDef = ColumnDef> {
  constructor(readonly def: TDef) {}

  private with(patch: Partial<ColumnDef>): ColumnBuilder<TDef> {
    return new ColumnBuilder({ ...this.def, ...patch } as TDef);
  }

  notNull(): ColumnBuilder<TDef> {
    return this.with({ nullable: false });
  }

  /**
   * Explicitly marks the column nullable. Columns are nullable by default,
   * so this is a no-op for the generated SQL — it exists so authors can
   * state intent (and so scaffold templates that call `.nullable()` don't
   * crash). Returning `this` keeps the builder immutable-consistent.
   */
  nullable(): ColumnBuilder<TDef> {
    return this.with({ nullable: true });
  }

  primaryKey(): ColumnBuilder<TDef> {
    return this.with({ primaryKey: true, nullable: false });
  }

  unique(): ColumnBuilder<TDef> {
    return this.with({ unique: true });
  }

  default(sqlExpression: string): ColumnBuilder<TDef> {
    return this.with({ default: sqlExpression });
  }

  references(
    table: string,
    column: string = 'id',
    options?: { onDelete?: OnDelete },
  ): ColumnBuilder<TDef> {
    return this.with({
      references: { table, column, onDelete: options?.onDelete },
    });
  }
}

function col(sqlType: string): ColumnBuilder {
  return new ColumnBuilder({
    sqlType,
    nullable: true,
    primaryKey: false,
    unique: false,
  });
}

export function text(): ColumnBuilder {
  return col('text');
}

export function varchar(length: number): ColumnBuilder {
  if (!Number.isInteger(length) || length <= 0 || length > 10_485_760) {
    throw new Error(`varchar length must be a positive integer, got ${length}`);
  }
  return col(`varchar(${length})`);
}

export function integer(): ColumnBuilder {
  return col('integer');
}

export function bigint(): ColumnBuilder {
  return col('bigint');
}

export function boolean(): ColumnBuilder {
  return col('boolean');
}

export function timestamp(): ColumnBuilder {
  return col('timestamptz');
}

export function jsonb(): ColumnBuilder {
  return col('jsonb');
}

export function uuid(): ColumnBuilder {
  return col('uuid');
}

export function vector(_dimensions: number): ColumnBuilder {
  // Briven's data plane runs on DoltGres, which does not support the
  // `vector(N)` column type — emitting it produces SQL that only fails
  // later at apply time with an opaque syntax error. Fail early here
  // instead. Vector search is a planned feature that will arrive with
  // LanceDB, at which point this builder can construct a real column.
  throw new Error(
    'vector columns are not supported yet on DoltGres — vector search is coming with LanceDB',
  );
}
