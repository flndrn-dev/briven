import type { PoolConnection } from 'mysql2/promise';

import type {
  Ctx,
  DbClient,
  DeleteQuery,
  InsertQuery,
  SelectQuery,
  TableQuery,
  UpdateQuery,
  VectorSearchInput,
  VectorSearchQuery,
} from '@briven/schema';

/**
 * Phase 1 query builder backed by `mysql2` and a per-invoke transaction.
 *
 * Scope: covers the 90% path from the `Ctx` interface in @briven/schema —
 * select / insert / update / delete with where (equality), orderBy, limit,
 * offset. Predicates beyond equality, joins, transactions exposed to user
 * code, and parameterised raw queries land in Phase 2.
 *
 * Table and column names are validated to a strict identifier shape before
 * being interpolated into SQL — never accept arbitrary strings here.
 *
 * @README-BRIVEN ADR 0001 — migrated from postgres to mysql2.
 *
 *   - Identifier quoting: `"name"` → `` `name` `` (MySQL backticks)
 *   - Parameter placeholders: `$1`, `$2` → `?` (MySQL positional only)
 *   - `RETURNING` clause: **removed** — MySQL does not support it.
 *     Queries with `.returning()` return an empty array.
 *     **Phase 5** must implement post-INSERT/UPDATE/DELETE SELECT.
 *   - Vector search: pgvector operators (`<->`, `<#>`, `<=>`) are
 *     Postgres-only. `vectorSearch()` throws an error.
 *     **Phase 5** replaces with LanceDB embedded.
 *   - `postgres.TransactionSql` → `mysql.PoolConnection`
 *   - `tx.unsafe(sql, params)` → `conn.query(sql, params)`
 */

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

/**
 * @README-BRIVEN MySQL uses backticks for identifier quoting,
 * not double quotes.
 */
function quote(name: string): string {
  if (!IDENT.test(name)) {
    throw new Error(`invalid identifier: ${JSON.stringify(name)}`);
  }
  return `\`${name}\``;
}

function quoteList(names: readonly string[]): string {
  return names.map(quote).join(', ');
}

class WhereClause {
  private readonly parts: string[] = [];
  private readonly params: unknown[] = [];

  add(predicate: Record<string, unknown>): void {
    for (const [col, value] of Object.entries(predicate)) {
      this.parts.push(`${quote(col)} = ?`);
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
    private readonly conn: PoolConnection,
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
    const [rows] = await this.conn.query(sql, this.w.values());
    return rows as unknown[];
  }
}

class InsertImpl implements InsertQuery {
  private returningCols: readonly string[] | null = null;

  constructor(
    private readonly conn: PoolConnection,
    private readonly table: string,
    private readonly values: Record<string, unknown> | readonly Record<string, unknown>[],
  ) {}

  returning(cols?: readonly string[]): PromiseLike<unknown[]> {
    this.returningCols = cols ?? [];
    // @README-BRIVEN Phase 5: MySQL has no RETURNING clause.
    // Currently returns empty array. Phase 5 must implement
    // post-INSERT SELECT to return inserted rows.
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
        return '?';
      });
      return `(${placeholders.join(', ')})`;
    });
    // @README-BRIVEN: no RETURNING clause in MySQL.
    // Phase 5: follow INSERT with SELECT WHERE to return rows.
    const sql = `INSERT INTO ${quote(this.table)} (${colSql}) VALUES ${valueRows.join(', ')}`;
    if (this.returningCols !== null) {
      // RETURNING is not supported — caller gets empty array.
      // Phase 5 will add SELECT after INSERT.
    }
    await this.conn.query(sql, params);
    return [];
  }
}

class UpdateImpl implements UpdateQuery {
  private readonly w = new WhereClause();
  private returningCols: readonly string[] | null = null;

  constructor(
    private readonly conn: PoolConnection,
    private readonly table: string,
    private readonly patch: Record<string, unknown>,
  ) {}

  where(p: Record<string, unknown>): UpdateQuery {
    this.w.add(p);
    return this;
  }

  returning(cols?: readonly string[]): PromiseLike<unknown[]> {
    this.returningCols = cols ?? [];
    // @README-BRIVEN Phase 5: MySQL has no RETURNING clause.
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
      setParts.push(`${quote(col)} = ?`);
    }
    const whereSql = this.w.sql();
    const allParams = [...params, ...this.w.values()];
    // @README-BRIVEN: no RETURNING clause in MySQL.
    // Phase 5: follow UPDATE with SELECT WHERE to return updated rows.
    let sql = `UPDATE ${quote(this.table)} SET ${setParts.join(', ')}${whereSql}`;
    if (this.returningCols !== null) {
      // RETURNING is not supported — caller gets empty array.
    }
    await this.conn.query(sql, allParams);
    return [];
  }
}

class DeleteImpl implements DeleteQuery {
  private readonly w = new WhereClause();
  private returningCols: readonly string[] | null = null;

  constructor(
    private readonly conn: PoolConnection,
    private readonly table: string,
  ) {}

  where(p: Record<string, unknown>): DeleteQuery {
    this.w.add(p);
    return this;
  }

  returning(cols?: readonly string[]): PromiseLike<unknown[]> {
    this.returningCols = cols ?? [];
    // @README-BRIVEN Phase 5: MySQL has no RETURNING clause.
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
      // @README-BRIVEN Phase 5: MySQL has no RETURNING clause.
      // Caller gets empty array. Phase 5 adds post-DELETE SELECT.
    }
    await this.conn.query(sql, this.w.values());
    return [];
  }
}

/**
 * @README-BRIVEN Phase 5: pgvector operators (`<->`, `<#>`, `<=>`)
 * are Postgres-only. Vector search via LanceDB embedded replaces
 * this implementation in Phase 5. For now, throws an error.
 */
class VectorSearchImpl implements VectorSearchQuery {
  private readonly w = new WhereClause();
  private selectedCols: readonly string[] | null = null;

  constructor(
    private readonly conn: PoolConnection,
    private readonly table: string,
    private readonly input: VectorSearchInput,
  ) {}

  where(p: Record<string, unknown>): VectorSearchQuery {
    this.w.add(p);
    return this;
  }

  select(cols: readonly string[]): VectorSearchQuery {
    this.selectedCols = cols;
    return this;
  }

  then<R1 = unknown[], R2 = never>(
    onfulfilled?: ((value: unknown[]) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.execute().then(onfulfilled as never, onrejected);
  }

  private async execute(): Promise<unknown[]> {
    throw new Error(
      'ctx.db().vectorSearch() is not available yet. ' +
      'Vector search will ship with LanceDB in Phase 5. ' +
      'See docs/ADR/0001-dolt-migration.md § "Vector search".',
    );
  }
}

/**
 * Build a `DbClient` and a Set the caller can read after the function
 * resolves — every `ctx.db('<table>')` call records the table name. The
 * realtime service uses this to decide which tables to watch for
 * change-driven re-invocation.
 *
 * @README-BRIVEN Phase 2: The realtime service replaces Postgres LISTEN/NOTIFY
 * with Dolt commit-diff polling. The `touched` Set is still recorded; Phase 2
 * consumes it via the PollManager instead of LISTEN channels.
 */
export function buildDbClient(conn: PoolConnection): {
  db: DbClient;
  touched: Set<string>;
} {
  const touched = new Set<string>();
  const dbFn = ((table: string): TableQuery => {
    touched.add(table);
    return {
      select: (cols) => new SelectImpl(conn, table, cols),
      insert: (values) => new InsertImpl(conn, table, values),
      update: (patch) => new UpdateImpl(conn, table, patch),
      delete: () => new DeleteImpl(conn, table),
      vectorSearch: (input) => new VectorSearchImpl(conn, table, input),
    };
  }) as DbClient;

  dbFn.execute = async (sql: string, params: readonly unknown[] = []) => {
    const [rows] = await conn.query(sql, [...params]);
    return rows as unknown[];
  };

  return { db: dbFn, touched };
}

export function makeCtx(
  conn: PoolConnection,
  request: {
    requestId: string;
    auth: Ctx['auth'];
    env?: Readonly<Record<string, string>>;
    log?: Ctx['log'];
  },
): { ctx: Ctx; touched: Set<string> } {
  const { db, touched } = buildDbClient(conn);
  const ctx: Ctx = {
    db,
    requestId: request.requestId,
    log: request.log ?? {
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
