/**
 * `Ctx` is the object injected into every query / mutation / action
 * function at invocation time by the briven runtime. It is declared in
 * `@briven/schema` so authors can type their functions without importing
 * anything from the runtime itself.
 *
 * The runtime provides the concrete implementation; this file is the
 * compile-time surface.
 */
export interface Ctx {
  /** Typed query builder against the project's postgres schema. */
  readonly db: DbClient;
  /** Invocation identifier — stable per request, correlated in logs. */
  readonly requestId: string;
  /** Structured logger — never log customer data (CLAUDE.md §5.1). */
  readonly log: Logger;
  /** Secrets / env vars injected by the control plane. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** If the call was authenticated, the resolved user. */
  readonly auth: AuthContext | null;
}

export interface AuthContext {
  readonly userId: string;
  readonly tokenType: 'session' | 'api_key';
}

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

/**
 * Minimal query surface. Phase 1 covers the 90% path: select, insert,
 * update, delete. The returned builders are async-iterable for streaming
 * results; the runtime maps each call into a parameterised SQL statement
 * against the project's schema.
 */
export interface DbClient {
  <TTable extends string>(table: TTable): TableQuery;
  execute(sql: string, params?: readonly unknown[]): Promise<unknown[]>;
}

export interface TableQuery {
  select(columns?: readonly string[]): SelectQuery;
  insert(values: Record<string, unknown> | readonly Record<string, unknown>[]): InsertQuery;
  update(patch: Record<string, unknown>): UpdateQuery;
  delete(): DeleteQuery;
  /**
   * Nearest-neighbour search against a pgvector column. Compiles to
   *   SELECT … FROM <table> WHERE … ORDER BY <column> <distance-op> $1 LIMIT $2
   * where `distance-op` is `<->` (L2, default), `<#>` (negative inner
   * product), or `<=>` (cosine). The vector column must be declared via
   * `vector(N)` in the project schema; ordering by a non-vector column
   * is a runtime error.
   */
  vectorSearch(input: VectorSearchInput): VectorSearchQuery;
}

export interface SelectQuery extends PromiseLike<unknown[]> {
  where(predicate: Record<string, unknown>): SelectQuery;
  orderBy(column: string, direction?: 'asc' | 'desc'): SelectQuery;
  limit(n: number): SelectQuery;
  offset(n: number): SelectQuery;
}

export interface VectorSearchInput {
  /** Column name on the table — must be a `vector(N)` column. */
  readonly column: string;
  /** Query embedding. Length must match the column's declared dimensions
   *  or the runtime throws. */
  readonly vector: readonly number[];
  /** Distance operator. Default 'l2'. */
  readonly distance?: 'l2' | 'inner_product' | 'cosine';
  /** Top-K. Default 10, hard cap 1000. */
  readonly limit?: number;
}

export interface VectorSearchQuery extends PromiseLike<unknown[]> {
  /** Restrict the candidate set before ranking. Same shape as SelectQuery.where. */
  where(predicate: Record<string, unknown>): VectorSearchQuery;
  /** Choose the columns the query returns. Default is all columns. */
  select(columns: readonly string[]): VectorSearchQuery;
}

export interface InsertQuery extends PromiseLike<unknown[]> {
  returning(columns?: readonly string[]): PromiseLike<unknown[]>;
}

export interface UpdateQuery extends PromiseLike<unknown[]> {
  where(predicate: Record<string, unknown>): UpdateQuery;
  returning(columns?: readonly string[]): PromiseLike<unknown[]>;
}

export interface DeleteQuery extends PromiseLike<unknown[]> {
  where(predicate: Record<string, unknown>): DeleteQuery;
  returning(columns?: readonly string[]): PromiseLike<unknown[]>;
}
