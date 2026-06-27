// Runs inside the Deno isolate.
//
// Wire protocol:
//   stdin:  newline-delimited JSON HostToIsolate messages
//   stdout: newline-delimited JSON IsolateToHost messages
//   stderr: newline-delimited JSON LogLine envelopes (best-effort)

const encoder = new TextEncoder();
const originalStderrWrite = Deno.stderr.write.bind(Deno.stderr);

let currentRequestId: string | null = null;

function writeStdout(obj: unknown): Promise<number> {
  return Deno.stdout.write(encoder.encode(JSON.stringify(obj) + '\n'));
}

function emitLog(level: 'debug' | 'info' | 'warn' | 'error', args: unknown[]): void {
  const msg = args.map(stringify).join(' ');
  const line = JSON.stringify({
    type: 'log',
    requestId: currentRequestId,
    level,
    msg,
    ts: Date.now(),
  }) + '\n';
  originalStderrWrite(encoder.encode(line));
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// Replace global console — must happen before customer code runs.
(globalThis as { console: unknown }).console = {
  log: (...a: unknown[]) => emitLog('info', a),
  info: (...a: unknown[]) => emitLog('info', a),
  warn: (...a: unknown[]) => emitLog('warn', a),
  error: (...a: unknown[]) => emitLog('error', a),
  debug: (...a: unknown[]) => emitLog('debug', a),
};

// Belt-and-braces v6 deny — Deno 2.x's --deny-net doesn't accept v6 CIDRs,
// so we shim fetch to reject literal v6 addresses in ::1, fc00::/7, fe80::/10.
// Hostnames that resolve to v6 are NOT covered here — the Phase 3 host-level
// proxy will close that gap. This guards the obvious literal-IP case.
const originalFetch = globalThis.fetch;
function isBlockedV6(host: string): boolean {
  // strip brackets if present
  const h = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  // ::1 (loopback)
  if (h === '::1') return true;
  // fc00::/7 — first 7 bits = 1111110_ → first hextet starts with fc or fd
  if (/^fc[0-9a-f]{2}:/i.test(h) || /^fd[0-9a-f]{2}:/i.test(h)) return true;
  // fe80::/10 — first 10 bits → first hextet starts with fe8, fe9, fea, feb
  if (/^fe[89ab][0-9a-f]:/i.test(h)) return true;
  return false;
}
(globalThis as { fetch: typeof fetch }).fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  try {
    const url = typeof input === 'string' || input instanceof URL ? new URL(input.toString()) : new URL(input.url);
    if (isBlockedV6(url.hostname)) {
      return Promise.reject(
        Object.assign(new Error(`fetch blocked: IPv6 ${url.hostname} in deny range`), { name: 'PermissionDenied' }),
      );
    }
  } catch { /* fall through */ }
  return originalFetch(input as never, init);
}) as typeof fetch;

// Pending queries — qid → resolver. Multiple in flight per invocation
// when customer uses Promise.all.
const pendingQueries = new Map<
  string,
  { resolve: (rows: readonly unknown[]) => void; reject: (err: Error) => void }
>();
let qidCounter = 0;

// ---------------------------------------------------------------------------
// Ctx — structurally satisfies `Ctx` from @briven/schema. We can't import
// from @briven/schema here because loop.ts is materialized into the isolate
// and resolved by Deno (no node_modules access). The shape MUST stay in sync
// with packages/schema/src/ctx.ts.
// ---------------------------------------------------------------------------

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

export interface SelectQuery extends PromiseLike<unknown[]> {
  where(predicate: Record<string, unknown>): SelectQuery;
  orderBy(column: string, direction?: 'asc' | 'desc'): SelectQuery;
  limit(n: number): SelectQuery;
  offset(n: number): SelectQuery;
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

export interface VectorSearchInput {
  readonly column: string;
  readonly vector: readonly number[];
  readonly distance?: 'l2' | 'inner_product' | 'cosine';
  readonly limit?: number;
}

export interface VectorSearchQuery extends PromiseLike<unknown[]> {
  where(predicate: Record<string, unknown>): VectorSearchQuery;
  select(columns: readonly string[]): VectorSearchQuery;
}

export interface TableQuery {
  select(columns?: readonly string[]): SelectQuery;
  insert(values: Record<string, unknown> | readonly Record<string, unknown>[]): InsertQuery;
  update(patch: Record<string, unknown>): UpdateQuery;
  delete(): DeleteQuery;
  vectorSearch(input: VectorSearchInput): VectorSearchQuery;
}

export interface DbClient {
  <TTable extends string>(table: TTable): TableQuery;
  execute(sql: string, params?: readonly unknown[]): Promise<unknown[]>;
}

export interface Ctx {
  readonly db: DbClient;
  readonly requestId: string;
  readonly log: Logger;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly auth: AuthContext | null;
}

// ---------------------------------------------------------------------------
// Query plumbing
// ---------------------------------------------------------------------------

/**
 * Allocate a qid, register a pending entry, send the query frame to the host,
 * and return a promise that resolves with the rows the host sends back.
 *
 * Centralising this means every builder's `then()` and `db.execute()` shares
 * the same null-guard, error-rejection, and stdout-failure handling.
 */
function sendQuery(req: { sql: string; params: readonly unknown[]; table: string }): Promise<unknown[]> {
  if (currentRequestId === null) {
    return Promise.reject(new Error('ctx.db(...) used outside an invocation'));
  }
  const requestId = currentRequestId;
  const qid = `q${++qidCounter}`;
  return new Promise<unknown[]>((resolve, reject) => {
    pendingQueries.set(qid, {
      resolve: (rows) => resolve(rows as unknown[]),
      reject,
    });
    writeStdout({
      type: 'query',
      requestId,
      qid,
      sql: req.sql,
      params: req.params,
      table: req.table,
    }).catch((err: unknown) => {
      pendingQueries.delete(qid);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

function makeCtx(auth: AuthContext | null, requestId: string): Ctx {
  const db = ((table: string) => makeTableProxy(table)) as DbClient;
  db.execute = (sql: string, params?: readonly unknown[]) =>
    sendQuery({ sql, params: params ?? [], table: '' });

  const log: Logger = {
    debug: (event, fields) => emitLog('debug', fields ? [event, fields] : [event]),
    info: (event, fields) => emitLog('info', fields ? [event, fields] : [event]),
    warn: (event, fields) => emitLog('warn', fields ? [event, fields] : [event]),
    error: (event, fields) => emitLog('error', fields ? [event, fields] : [event]),
  };

  const env = new Proxy({} as Record<string, string | undefined>, {
    get(_, key: string) {
      return Deno.env.get(key);
    },
    ownKeys() {
      // Phase 1: customer iterates ctx.env at their own peril; allow-env
      // gates which keys are even visible to Deno.env.
      return [];
    },
  });

  return {
    db,
    requestId,
    log,
    env,
    auth,
  };
}

function makeTableProxy(table: string): TableQuery {
  return {
    select: (columns?: readonly string[]) => makeSelectProxy(table, columns),
    insert: (values) => makeInsertProxy(table, values),
    update: (patch) => makeUpdateProxy(table, patch),
    delete: () => makeDeleteProxy(table),
    vectorSearch: (input) => makeVectorSearchProxy(table, input),
  };
}

// ---------------------------------------------------------------------------
// SELECT
// ---------------------------------------------------------------------------

interface SelectState {
  where?: Record<string, unknown>;
  orderBy?: { col: string; dir: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
}

function makeSelectProxy(
  table: string,
  columns?: readonly string[],
  state: SelectState = {},
): SelectQuery {
  const run = (): Promise<unknown[]> => {
    const { sql, params } = buildSelectSql(table, columns, state);
    return sendQuery({ sql, params, table });
  };
  return {
    where(p) {
      return makeSelectProxy(table, columns, { ...state, where: { ...state.where, ...p } });
    },
    orderBy(col, dir = 'asc') {
      return makeSelectProxy(table, columns, { ...state, orderBy: { col, dir } });
    },
    limit(n) {
      return makeSelectProxy(table, columns, { ...state, limit: n });
    },
    offset(n) {
      return makeSelectProxy(table, columns, { ...state, offset: n });
    },
    then(onfulfilled, onrejected) {
      return run().then(onfulfilled as never, onrejected as never);
    },
  };
}

// ---------------------------------------------------------------------------
// INSERT
// ---------------------------------------------------------------------------

function makeInsertProxy(
  table: string,
  values: Record<string, unknown> | readonly Record<string, unknown>[],
  returningCols: readonly string[] | null = null,
): InsertQuery {
  const run = (): Promise<unknown[]> => {
    const { sql, params } = buildInsertSql(table, values, returningCols);
    return sendQuery({ sql, params, table });
  };
  return {
    returning(cols) {
      const next = cols ?? [];
      return makeInsertProxy(table, values, next);
    },
    then(onfulfilled, onrejected) {
      return run().then(onfulfilled as never, onrejected as never);
    },
  };
}

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

interface UpdateState {
  where?: Record<string, unknown>;
}

function makeUpdateProxy(
  table: string,
  patch: Record<string, unknown>,
  state: UpdateState = {},
  returningCols: readonly string[] | null = null,
): UpdateQuery {
  const run = (): Promise<unknown[]> => {
    const { sql, params } = buildUpdateSql(table, patch, state, returningCols);
    return sendQuery({ sql, params, table });
  };
  return {
    where(p) {
      return makeUpdateProxy(
        table,
        patch,
        { ...state, where: { ...state.where, ...p } },
        returningCols,
      );
    },
    returning(cols) {
      return makeUpdateProxy(table, patch, state, cols ?? []);
    },
    then(onfulfilled, onrejected) {
      return run().then(onfulfilled as never, onrejected as never);
    },
  };
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

interface DeleteState {
  where?: Record<string, unknown>;
}

function makeDeleteProxy(
  table: string,
  state: DeleteState = {},
  returningCols: readonly string[] | null = null,
): DeleteQuery {
  const run = (): Promise<unknown[]> => {
    const { sql, params } = buildDeleteSql(table, state, returningCols);
    return sendQuery({ sql, params, table });
  };
  return {
    where(p) {
      return makeDeleteProxy(table, { ...state, where: { ...state.where, ...p } }, returningCols);
    },
    returning(cols) {
      return makeDeleteProxy(table, state, cols ?? []);
    },
    then(onfulfilled, onrejected) {
      return run().then(onfulfilled as never, onrejected as never);
    },
  };
}

// ---------------------------------------------------------------------------
// VECTOR SEARCH
// ---------------------------------------------------------------------------

/**
 * Phase 5 stub — mirrors apps/runtime/src/query-builder.ts VectorSearchImpl.
 * pgvector operators (`<->`, `<#>`, `<=>`) ship with LanceDB embedded in
 * Phase 5. Until then `where()`/`select()` are no-ops and awaiting the query
 * throws the same friendly error the inline executor raises, so both
 * executors behave identically under deno and inline.
 */
function makeVectorSearchProxy(table: string, input: VectorSearchInput): VectorSearchQuery {
  const run = (): Promise<unknown[]> =>
    Promise.reject(
      new Error(
        `ctx.db('${table}').vectorSearch({ column: '${input.column}' }) ` +
          'is not available yet. Vector search will ship with LanceDB in Phase 5.',
      ),
    );
  return {
    where() {
      return makeVectorSearchProxy(table, input);
    },
    select() {
      return makeVectorSearchProxy(table, input);
    },
    then(onfulfilled, onrejected) {
      return run().then(onfulfilled as never, onrejected as never);
    },
  };
}

// ---------------------------------------------------------------------------
// SQL builders — mirror apps/runtime/src/query-builder.ts identifier rules.
// ---------------------------------------------------------------------------

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
function quote(name: string): string {
  if (!IDENT.test(name)) throw new Error(`invalid identifier: ${JSON.stringify(name)}`);
  return `"${name}"`;
}

function quoteList(names: readonly string[]): string {
  return names.map(quote).join(', ');
}

function buildSelectSql(
  table: string,
  columns: readonly string[] | undefined,
  state: SelectState,
): { sql: string; params: readonly unknown[] } {
  const cols = columns ? quoteList(columns) : '*';
  let sql = `SELECT ${cols} FROM ${quote(table)}`;
  const params: unknown[] = [];
  if (state.where && Object.keys(state.where).length > 0) {
    const parts: string[] = [];
    for (const [col, val] of Object.entries(state.where)) {
      parts.push(`${quote(col)} = $${params.length + 1}`);
      params.push(val);
    }
    sql += ' WHERE ' + parts.join(' AND ');
  }
  if (state.orderBy) sql += ` ORDER BY ${quote(state.orderBy.col)} ${state.orderBy.dir.toUpperCase()}`;
  if (state.limit != null) sql += ` LIMIT ${Number(state.limit)}`;
  if (state.offset != null) sql += ` OFFSET ${Number(state.offset)}`;
  return { sql, params };
}

function buildInsertSql(
  table: string,
  values: Record<string, unknown> | readonly Record<string, unknown>[],
  returningCols: readonly string[] | null,
): { sql: string; params: readonly unknown[] } {
  const rows = Array.isArray(values) ? values : [values as Record<string, unknown>];
  if (rows.length === 0) {
    // Postgres has no useful zero-row INSERT shape; surface explicitly so the
    // host doesn't try to send malformed SQL.
    throw new Error('insert() called with empty array');
  }
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
  let sql = `INSERT INTO ${quote(table)} (${colSql}) VALUES ${valueRows.join(', ')}`;
  if (returningCols !== null) {
    const ret = returningCols.length === 0 ? '*' : quoteList(returningCols);
    sql += ` RETURNING ${ret}`;
  }
  return { sql, params };
}

function buildUpdateSql(
  table: string,
  patch: Record<string, unknown>,
  state: UpdateState,
  returningCols: readonly string[] | null,
): { sql: string; params: readonly unknown[] } {
  const setParts: string[] = [];
  const params: unknown[] = [];
  for (const [col, value] of Object.entries(patch)) {
    params.push(value);
    setParts.push(`${quote(col)} = $${params.length}`);
  }
  if (setParts.length === 0) {
    throw new Error('update() called with empty patch');
  }
  let sql = `UPDATE ${quote(table)} SET ${setParts.join(', ')}`;
  if (state.where && Object.keys(state.where).length > 0) {
    const whereParts: string[] = [];
    for (const [col, val] of Object.entries(state.where)) {
      params.push(val);
      whereParts.push(`${quote(col)} = $${params.length}`);
    }
    sql += ' WHERE ' + whereParts.join(' AND ');
  }
  if (returningCols !== null) {
    const ret = returningCols.length === 0 ? '*' : quoteList(returningCols);
    sql += ` RETURNING ${ret}`;
  }
  return { sql, params };
}

function buildDeleteSql(
  table: string,
  state: DeleteState,
  returningCols: readonly string[] | null,
): { sql: string; params: readonly unknown[] } {
  let sql = `DELETE FROM ${quote(table)}`;
  const params: unknown[] = [];
  if (state.where && Object.keys(state.where).length > 0) {
    const whereParts: string[] = [];
    for (const [col, val] of Object.entries(state.where)) {
      params.push(val);
      whereParts.push(`${quote(col)} = $${params.length}`);
    }
    sql += ' WHERE ' + whereParts.join(' AND ');
  }
  if (returningCols !== null) {
    const ret = returningCols.length === 0 ? '*' : quoteList(returningCols);
    sql += ` RETURNING ${ret}`;
  }
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

export async function runQuery(): Promise<never> {
  throw new Error('runQuery is reserved for future use');
}

export async function runIsolateLoop(
  dispatch: Record<string, (ctx: Ctx, args: unknown) => Promise<unknown> | unknown>,
  deploymentId: string,
): Promise<void> {
  // Send ready handshake.
  await writeStdout({ type: 'ready', deploymentId });

  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of Deno.stdin.readable) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg: { type: string } & Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        // Malformed input — surface a structured error to the host (when we
        // know the in-flight request) before exiting.
        if (currentRequestId !== null) {
          await writeStdout({
            type: 'error',
            requestId: currentRequestId,
            code: 'isolate_protocol_error',
            message: 'malformed input from host',
            durationMs: 0,
          }).catch(() => undefined);
        }
        Deno.exit(1);
      }
      if (msg.type === 'shutdown') {
        Deno.exit(0);
      } else if (msg.type === 'invoke') {
        // Do NOT await — the invoked function may issue queries whose
        // `query_result` replies arrive as *later* stdin messages handled by
        // THIS same loop. Awaiting here blocks the reader, so the reply is
        // never read, the query promise never resolves, and Deno aborts with
        // "Top-level await promise never resolved" (a self-deadlock). Running
        // it concurrently lets the loop keep reading; handleInvoke writes its
        // own result/error frame to stdout when it finishes. The host
        // serialises one invocation per isolate, so at most one is in flight.
        void handleInvoke(msg as never, dispatch).catch(() => undefined);
      } else if (msg.type === 'query_result') {
        const m = msg as { qid: string; rows?: readonly unknown[]; error?: { code: string; message: string } };
        const pending = pendingQueries.get(m.qid);
        if (pending) {
          pendingQueries.delete(m.qid);
          if (m.error) pending.reject(new Error(m.error.message));
          else pending.resolve(m.rows ?? []);
        } else {
          emitLog('warn', [`unknown qid: ${m.qid}`]);
        }
      }
    }
  }
}

async function handleInvoke(
  msg: { requestId: string; functionName: string; args: unknown; auth: AuthContext | null },
  dispatch: Record<string, (ctx: Ctx, args: unknown) => Promise<unknown> | unknown>,
): Promise<void> {
  currentRequestId = msg.requestId;
  const started = performance.now();
  const fn = dispatch[msg.functionName];
  try {
    if (!fn) throw new Error(`function not found: ${msg.functionName}`);
    const ctx = makeCtx(msg.auth, msg.requestId);
    const value = await fn(ctx, msg.args);
    const durationMs = Math.round(performance.now() - started);
    try {
      await writeStdout({
        type: 'result',
        requestId: msg.requestId,
        value,
        durationMs,
      });
    } catch {
      // Most likely the value contains something JSON.stringify can't
      // serialise (cyclic ref, BigInt, etc.). Fall back to a structured
      // error frame so the host doesn't hang waiting for a result.
      await writeStdout({
        type: 'error',
        requestId: msg.requestId,
        code: 'function_threw',
        message: 'result not JSON-serializable',
        durationMs,
      }).catch(() => undefined);
    }
  } catch (err) {
    const e = err as { name?: string; message?: string };
    let code = 'function_threw';
    if (e?.name === 'PermissionDenied') {
      code = (e.message ?? '').includes('net') ? 'network_blocked'
        : (e.message ?? '').includes('env') ? 'env_access_denied'
        : 'fs_access_denied';
    }
    await writeStdout({
      type: 'error',
      requestId: msg.requestId,
      code,
      message: e?.message ?? String(err),
      durationMs: Math.round(performance.now() - started),
    });
  } finally {
    currentRequestId = null;
  }
}
