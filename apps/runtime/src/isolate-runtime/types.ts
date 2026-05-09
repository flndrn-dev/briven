/**
 * JSON-RPC message types between host and Deno isolate.
 * NDJSON-framed (one JSON object per line on stdin/stdout).
 *
 * stderr is reserved for structured logs (LogLine type) and unstructured
 * output captured as best-effort error logs.
 */

export type HostToIsolate = InvokeMsg | QueryResultMsg | ShutdownMsg;
export type IsolateToHost = ReadyMsg | QueryMsg | ResultMsg | ErrorMsg;

export interface InvokeMsg {
  type: 'invoke';
  requestId: string;
  functionName: string;
  args: unknown;
  auth: { userId: string; tokenType: 'session' | 'api_key' } | null;
}

export interface QueryResultMsg {
  type: 'query_result';
  requestId: string;
  qid: string;
  rows?: readonly unknown[];
  error?: { code: string; message: string };
}

export interface ShutdownMsg {
  type: 'shutdown';
}

export interface ReadyMsg {
  type: 'ready';
  deploymentId: string;
}

export interface QueryMsg {
  type: 'query';
  requestId: string;
  qid: string;
  // Phase 1: forward whole `db('<table>').select().where(...)` chain as a
  // single SQL string + params produced by the isolate-side stub.
  sql: string;
  params: readonly unknown[];
  // Tables touched by this query — host appends to the per-invocation
  // touchedTables set used for realtime LISTEN subscriptions.
  table: string;
}

export interface ResultMsg {
  type: 'result';
  requestId: string;
  value: unknown;
  durationMs: number;
}

export interface ErrorMsg {
  type: 'error';
  requestId: string;
  code: string;
  message: string;
  durationMs: number;
}

export interface LogLine {
  type: 'log';
  requestId: string | null;
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  ts: number;
}

export type RuntimeErrorCode =
  | 'function_threw'
  | 'function_not_found'
  | 'function_not_exported'
  | 'network_blocked'
  | 'env_access_denied'
  | 'fs_access_denied'
  | 'import_blocked'
  | 'memory_limit_exceeded'
  | 'invocation_timeout'
  | 'host_overloaded'
  | 'isolate_crashed'
  | 'isolate_spawn_timeout'
  | 'isolate_protocol_error'
  | 'deployment_unhealthy'
  | 'deployment_not_found'
  | 'bundle_fetch_failed'
  | 'no_deployment'
  | 'executor_not_implemented';
