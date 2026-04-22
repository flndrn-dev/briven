import type postgres from 'postgres';

import type {
  Ctx,
  DbClient,
  DeleteQuery,
  InsertQuery,
  SelectQuery,
  TableQuery,
  UpdateQuery,
} from '@briven/schema';

/**
 * Phase 1 query builder backed by `postgres` and a per-invoke transaction.
 *
 * Scope: covers the 90% path from the `Ctx` interface in @briven/schema —
 * select / insert / update / delete with where (equality), orderBy, limit,
 * offset, returning. Predicates beyond equality, joins, transactions
 * exposed to user code, and parameterised raw queries land in Phase 2.
 *
 * Table and column names are validated to a strict identifier shape before
 * being interpolated into SQL — never accept arbitrary strings here.
 */

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

function quote(name: string): string {
  if (!IDENT.test(name)) {
    throw new Error(`invalid identifier: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

function quoteList(names: readonly string[]): string {
  return names.map(quote).join(', ');
}

class WhereClause {
  private readonly parts: string[] = [];
  private readonly params: unknown[] = [];

  add(predicate: Record<string, unknown>): void {
    for (const [col, value] of Object.entries(predicate)) {
      this.parts.push(`${quote(col)} = $${this.params.length + 1}`);
      this.params.push(value);
    }
  }

  sql(): string {
    return this.parts.length === 0 ? '' : ` WHERE ${this.parts.join(' AND ')}`;
  }

  values(): unknown[] {
    return this.params;
  }
}

class SelectImpl implements SelectQuery {
  private columns: readonly string[] | null = null;
  private readonly w = new WhereClause();
  private order: { col: string; dir: 'asc' | 'desc' } | null = null;
  private _limit: number | null = null;
  private _offset: number | null = null;

  constructor(
    private readonly tx: postgres.TransactionSql,
    private readonly table: string,
    columns?: readonly string[],
  ) {
    if (columns) this.columns = columns;
  }

  where(p: Record<string, unknown>): SelectQuery {
    this.w.add(p);
    return this;
  }

  orderBy(col: string, dir: 'asc' | 'desc' = 'asc'): SelectQuery {
    this.order = { col, dir };
    return this;
  }

  limit(n: number): SelectQuery {
    this._limit = n;
    return this;
  }

  offset(n: number): SelectQuery {
    this._offset = n;
    return this;
  }

  then<R1 = unknown[], R2 = never>(
    onfulfilled?: ((value: unknown[]) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.execute().then(onfulfilled as never, onrejected);
  }

  private async execute(): Promise<unknown[]> {
    const cols = this.columns ? quoteList(this.columns) : '*';
    let sql = `SELECT ${cols} FROM ${quote(this.table)}${this.w.sql()}`;
    if (this.order) sql += ` ORDER BY ${quote(this.order.col)} ${this.order.dir.toUpperCase()}`;
    if (this._limit !== null) sql += ` LIMIT ${Number(this._limit)}`;
    if (this._offset !== null) sql += ` OFFSET ${Number(this._offset)}`;
    return this.tx.unsafe(sql, this.w.values() as never[]) as Promise<unknown[]>;
  }
}

class InsertImpl implements InsertQuery {
  private returningCols: readonly string[] | null = null;

  constructor(
    private readonly tx: postgres.TransactionSql,
    private readonly table: string,
    private readonly values: Record<string, unknown> | readonly Record<string, unknown>[],
  ) {}

  returning(cols?: readonly string[]): PromiseLike<unknown[]> {
    this.returningCols = cols ?? [];
    return this.execute();
  }

  then<R1 = unknown[], R2 = never>(
    onfulfilled?: ((value: unknown[]) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.execute().then(onfulfilled as never, onrejected);
  }

  private async execute(): Promise<unknown[]> {
    const rows = Array.isArray(this.values) ? this.values : [this.values];
    if (rows.length === 0) return [];
    const cols = Object.keys(rows[0]!);
    const colSql = quoteList(cols);
    const params: unknown[] = [];
    const valueRows = rows.map((r) => {
      const placeholders = cols.map((c) => {
        params.push(r[c]);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    let sql = `INSERT INTO ${quote(this.table)} (${colSql}) VALUES ${valueRows.join(', ')}`;
    if (this.returningCols !== null) {
      const ret = this.returningCols.length === 0 ? '*' : quoteList(this.returningCols);
      sql += ` RETURNING ${ret}`;
    }
    return this.tx.unsafe(sql, params as never[]) as Promise<unknown[]>;
  }
}

class UpdateImpl implements UpdateQuery {
  private readonly w = new WhereClause();
  private returningCols: readonly string[] | null = null;

  constructor(
    private readonly tx: postgres.TransactionSql,
    private readonly table: string,
    private readonly patch: Record<string, unknown>,
  ) {}

  where(p: Record<string, unknown>): UpdateQuery {
    this.w.add(p);
    return this;
  }

  returning(cols?: readonly string[]): PromiseLike<unknown[]> {
    this.returningCols = cols ?? [];
    return this.execute();
  }

  then<R1 = unknown[], R2 = never>(
    onfulfilled?: ((value: unknown[]) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.execute().then(onfulfilled as never, onrejected);
  }

  private async execute(): Promise<unknown[]> {
    const setParts: string[] = [];
    const params: unknown[] = [];
    for (const [col, value] of Object.entries(this.patch)) {
      params.push(value);
      setParts.push(`${quote(col)} = $${params.length}`);
    }
    const whereParts = this.w.sql().replace(/\$(\d+)/g, (_, n) => {
      return `$${Number(n) + params.length}`;
    });
    let sql = `UPDATE ${quote(this.table)} SET ${setParts.join(', ')}${whereParts}`;
    if (this.returningCols !== null) {
      const ret = this.returningCols.length === 0 ? '*' : quoteList(this.returningCols);
      sql += ` RETURNING ${ret}`;
    }
    return this.tx.unsafe(sql, [...params, ...this.w.values()] as never[]) as Promise<unknown[]>;
  }
}

class DeleteImpl implements DeleteQuery {
  private readonly w = new WhereClause();
  private returningCols: readonly string[] | null = null;

  constructor(
    private readonly tx: postgres.TransactionSql,
    private readonly table: string,
  ) {}

  where(p: Record<string, unknown>): DeleteQuery {
    this.w.add(p);
    return this;
  }

  returning(cols?: readonly string[]): PromiseLike<unknown[]> {
    this.returningCols = cols ?? [];
    return this.execute();
  }

  then<R1 = unknown[], R2 = never>(
    onfulfilled?: ((value: unknown[]) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.execute().then(onfulfilled as never, onrejected);
  }

  private async execute(): Promise<unknown[]> {
    let sql = `DELETE FROM ${quote(this.table)}${this.w.sql()}`;
    if (this.returningCols !== null) {
      const ret = this.returningCols.length === 0 ? '*' : quoteList(this.returningCols);
      sql += ` RETURNING ${ret}`;
    }
    return this.tx.unsafe(sql, this.w.values() as never[]) as Promise<unknown[]>;
  }
}

/**
 * Build a `DbClient` and a Set the caller can read after the function
 * resolves — every `ctx.db('<table>')` call records the table name. The
 * realtime service uses this to decide which postgres LISTEN channels to
 * subscribe to for change-driven re-invocation.
 */
export function buildDbClient(tx: postgres.TransactionSql): {
  db: DbClient;
  touched: Set<string>;
} {
  const touched = new Set<string>();
  const dbFn = ((table: string): TableQuery => {
    touched.add(table);
    return {
      select: (cols) => new SelectImpl(tx, table, cols),
      insert: (values) => new InsertImpl(tx, table, values),
      update: (patch) => new UpdateImpl(tx, table, patch),
      delete: () => new DeleteImpl(tx, table),
    };
  }) as DbClient;

  dbFn.execute = async (sql: string, params: readonly unknown[] = []) => {
    return tx.unsafe(sql, [...params] as never[]) as Promise<unknown[]>;
  };

  return { db: dbFn, touched };
}

export function makeCtx(
  tx: postgres.TransactionSql,
  request: {
    requestId: string;
    auth: Ctx['auth'];
    env?: Readonly<Record<string, string>>;
  },
): { ctx: Ctx; touched: Set<string> } {
  const { db, touched } = buildDbClient(tx);
  const ctx: Ctx = {
    db,
    requestId: request.requestId,
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    env: Object.freeze({ ...(request.env ?? {}) }),
    auth: request.auth,
  };
  return { ctx, touched };
}
