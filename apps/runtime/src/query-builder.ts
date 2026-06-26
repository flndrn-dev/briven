import type { ProjectTx } from './db.js';
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
 * Phase 1 query builder backed by postgres.js (DoltGres) and a per-invoke
 * transaction.
 *
 * Scope: covers the 90% path from the `Ctx` interface in @briven/schema —
 * select / insert / update / delete with where (equality), orderBy, limit,
 * offset. Predicates beyond equality, joins, transactions exposed to user
 * code, and parameterised raw queries land in Phase 2.
 *
 * Table and column names are validated to a strict identifier shape before
 * being interpolated into SQL — never accept arbitrary strings here.
 *
 * @README-BRIVEN ADR 0001 — converged onto DoltGres (postgres.js driver),
 * off the abandoned mysql2 detour:
 *
 *   - Identifier quoting: `` `name` `` (MySQL backticks) → `"name"` (Postgres)
 *   - Parameter placeholders: `?` (MySQL positional) → `$1`, `$2`, … (Postgres)
 *   - `RETURNING`: now implemented for INSERT/UPDATE — `.returning()` returns
 *     the affected rows. DELETE is conservative (rowcount-only) until DoltGres
 *     DELETE … RETURNING is confirmed (see DeleteImpl).
 *   - Vector search: pgvector operators (`<->`, `<#>`, `<=>`) — `vectorSearch()`
 *     still throws; LanceDB embedded lands in Phase 5.
 *   - `mysql.PoolConnection` → `ProjectTx`
 *   - `conn.query(sql, params)` (returns `[rows]`) → `tx.unsafe(sql, params)`
 *     (returns the rows directly)
 */

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

/**
 * @README-BRIVEN Postgres/DoltGres quote identifiers with double quotes,
 * not MySQL backticks.
 */
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
  private readonly cols: string[] = [];
  private readonly params: unknown[] = [];

  add(predicate: Record<string, unknown>): void {
    for (const [col, value] of Object.entries(predicate)) {
      this.cols.push(col);
      this.params.push(value);
    }
  }

  /**
   * Render ` WHERE …` with `$N` positional placeholders. Postgres numbers
   * placeholders across the whole statement, so callers that bind params
   * before the WHERE (e.g. UPDATE … SET) pass the count already consumed as
   * `offset`; the first WHERE placeholder is then `$(offset + 1)`.
   */
  sql(offset = 0): string {
    if (this.cols.length === 0) return '';
    const parts = this.cols.map((col, i) => `${quote(col)} = $${offset + i + 1}`);
    return ` WHERE ${parts.join(' AND ')}`;
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
    private readonly tx: ProjectTx,
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
    let query = `SELECT ${cols} FROM ${quote(this.table)}${this.w.sql()}`;
    if (this.order) query += ` ORDER BY ${quote(this.order.col)} ${this.order.dir.toUpperCase()}`;
    if (this._limit !== null) query += ` LIMIT ${Number(this._limit)}`;
    if (this._offset !== null) query += ` OFFSET ${Number(this._offset)}`;
    const rows = await this.tx.unsafe(query, this.w.values() as never[]);
    return rows as unknown[];
  }
}

class InsertImpl implements InsertQuery {
  private returningCols: readonly string[] | null = null;

  constructor(
    private readonly tx: ProjectTx,
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
    let query = `INSERT INTO ${quote(this.table)} (${colSql}) VALUES ${valueRows.join(', ')}`;
    // @README-BRIVEN DoltGres supports INSERT … RETURNING. `.returning()` with
    // no columns means "all columns" (RETURNING *); otherwise the named columns.
    if (this.returningCols !== null) {
      query += ` RETURNING ${returningClause(this.returningCols)}`;
      const out = await this.tx.unsafe(query, params as never[]);
      return out as unknown[];
    }
    await this.tx.unsafe(query, params as never[]);
    return [];
  }
}

class UpdateImpl implements UpdateQuery {
  private readonly w = new WhereClause();
  private returningCols: readonly string[] | null = null;

  constructor(
    private readonly tx: ProjectTx,
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
    // WHERE placeholders continue numbering after the SET params.
    const whereSql = this.w.sql(params.length);
    const allParams = [...params, ...this.w.values()];
    let query = `UPDATE ${quote(this.table)} SET ${setParts.join(', ')}${whereSql}`;
    // @README-BRIVEN DoltGres supports UPDATE … RETURNING.
    if (this.returningCols !== null) {
      query += ` RETURNING ${returningClause(this.returningCols)}`;
      const out = await this.tx.unsafe(query, allParams as never[]);
      return out as unknown[];
    }
    await this.tx.unsafe(query, allParams as never[]);
    return [];
  }
}

class DeleteImpl implements DeleteQuery {
  private readonly w = new WhereClause();

  constructor(
    private readonly tx: ProjectTx,
    private readonly table: string,
  ) {}

  where(p: Record<string, unknown>): DeleteQuery {
    this.w.add(p);
    return this;
  }

  // @README-BRIVEN `cols` is intentionally ignored — see execute(): DoltGres
  // DELETE … RETURNING is not yet confirmed, so DELETE is rowcount-only for now.
  returning(_cols?: readonly string[]): PromiseLike<unknown[]> {
    return this.execute();
  }

  then<R1 = unknown[], R2 = never>(
    onfulfilled?: ((value: unknown[]) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.execute().then(onfulfilled as never, onrejected);
  }

  private async execute(): Promise<unknown[]> {
    const query = `DELETE FROM ${quote(this.table)}${this.w.sql()}`;
    // TODO(ADR 0001): DoltGres DELETE … RETURNING is not yet confirmed against
    // a live DoltGres (INSERT/UPDATE RETURNING are verified). Until then DELETE
    // runs plain and returns [] even when `.returning(cols)` was requested —
    // rowcount-only semantics, no rows. Once confirmed, capture cols in
    // returning() and append ` RETURNING ${returningClause(cols)}`, then return
    // the rows exactly like InsertImpl / UpdateImpl.
    await this.tx.unsafe(query, this.w.values() as never[]);
    return [];
  }
}

/**
 * Render a RETURNING column list. `null`/empty → `*` (all columns), otherwise
 * the named columns, double-quoted.
 */
function returningClause(cols: readonly string[] | null): string {
  return cols && cols.length > 0 ? quoteList(cols) : '*';
}

/**
 * @README-BRIVEN Phase 5: pgvector operators (`<->`, `<#>`, `<=>`)
 * are Postgres-only. Vector search via LanceDB embedded replaces
 * this implementation in Phase 5. For now, throws an error.
 */
class VectorSearchImpl implements VectorSearchQuery {
  // Stub: execute() throws before any query runs, so where()/select() are
  // no-ops and we store only what the error message reads. The full builder
  // (with a `tx`-bound query) lands with the Phase 5 implementation.
  constructor(
    private readonly table: string,
    private readonly input: VectorSearchInput,
  ) {}

  where(_p: Record<string, unknown>): VectorSearchQuery {
    return this;
  }

  select(_cols: readonly string[]): VectorSearchQuery {
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
      `ctx.db('${this.table}').vectorSearch({ column: '${this.input.column}' }) ` +
        'is not available yet. Vector search will ship with LanceDB in Phase 5.',
    );
  }
}

/**
 * Build a `DbClient` and a Set the caller can read after the function
 * resolves — every `ctx.db('<table>')` call records the table name. The
 * realtime service uses this to decide which tables to watch for
 * change-driven re-invocation.
 *
 * @README-BRIVEN Phase 2: The realtime service detects changes via Dolt
 * commit-diff polling (the auto-commit-per-write in withProjectTx advances
 * the Dolt version log on every mutating tx). The `touched` Set is still
 * recorded; Phase 2 consumes it via the PollManager.
 */
export function buildDbClient(tx: ProjectTx): {
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
      vectorSearch: (input) => new VectorSearchImpl(table, input),
    };
  }) as DbClient;

  dbFn.execute = async (sql: string, params: readonly unknown[] = []) => {
    const rows = await tx.unsafe(sql, [...params] as never[]);
    return rows as unknown[];
  };

  return { db: dbFn, touched };
}

export function makeCtx(
  tx: ProjectTx,
  request: {
    requestId: string;
    auth: Ctx['auth'];
    env?: Readonly<Record<string, string>>;
    log?: Ctx['log'];
  },
): { ctx: Ctx; touched: Set<string> } {
  const { db, touched } = buildDbClient(tx);
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
