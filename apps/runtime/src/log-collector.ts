import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-invocation log collector. Two sources feed it:
 *
 *   1. `ctx.log.{info,warn,error,debug}` — the structured API users should
 *      reach for first. Takes a message + optional fields object.
 *   2. `console.{log,info,warn,error,debug}` — the fallback for anything
 *      ported from elsewhere. We patch the global `console` ONCE at module
 *      load, and route through an AsyncLocalStorage-bound collector so two
 *      concurrent invocations on the inline executor don't cross-stream.
 *
 * Before publish, fields whose key matches SECRET_KEY_RE are replaced with
 * `[redacted]` so users who log their own env by accident don't leak it
 * to the tail stream.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  fieldsJson?: string;
  ts: string;
}

export interface LogCollector {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  drain(): LogEntry[];
}

const SECRET_KEY_RE = /^(password|secret|token|api[_-]?key|authorization)$/i;
const MAX_ENTRIES_PER_INVOCATION = 500;

const collectorAls = new AsyncLocalStorage<LogCollector>();

export function createLogCollector(): LogCollector {
  const entries: LogEntry[] = [];
  function push(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (entries.length >= MAX_ENTRIES_PER_INVOCATION) return;
    const entry: LogEntry = {
      level,
      message: String(message),
      ts: new Date().toISOString(),
    };
    if (fields && Object.keys(fields).length > 0) {
      entry.fieldsJson = JSON.stringify(redact(fields));
    }
    entries.push(entry);
  }
  return {
    debug: (m, f) => push('debug', m, f),
    info: (m, f) => push('info', m, f),
    warn: (m, f) => push('warn', m, f),
    error: (m, f) => push('error', m, f),
    drain: () => entries.splice(0, entries.length),
  };
}

export async function runWithCollector<T>(
  collector: LogCollector,
  fn: () => Promise<T>,
): Promise<T> {
  return collectorAls.run(collector, fn);
}

/**
 * One-time install: once called (from the module that sets up the runtime),
 * `console.*` is redirected whenever there's an active collector in the
 * async context. Outside an invocation the original `console` is used, so
 * infra logs still reach stdout/stderr as normal.
 */
let installed = false;
export function installConsolePatch(): void {
  if (installed) return;
  installed = true;
  const orig = {
    log: globalThis.console.log.bind(globalThis.console),
    info: globalThis.console.info.bind(globalThis.console),
    warn: globalThis.console.warn.bind(globalThis.console),
    error: globalThis.console.error.bind(globalThis.console),
    debug: globalThis.console.debug.bind(globalThis.console),
  };
  const route = (level: LogLevel, origFn: (...a: unknown[]) => void, args: unknown[]): void => {
    const c = collectorAls.getStore();
    if (!c) {
      origFn(...args);
      return;
    }
    c[level](formatArgs(args));
  };
  globalThis.console.log = (...args: unknown[]) => route('info', orig.log, args);
  globalThis.console.info = (...args: unknown[]) => route('info', orig.info, args);
  globalThis.console.warn = (...args: unknown[]) => route('warn', orig.warn, args);
  globalThis.console.error = (...args: unknown[]) => route('error', orig.error, args);
  globalThis.console.debug = (...args: unknown[]) => route('debug', orig.debug, args);
}

function formatArgs(args: readonly unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SECRET_KEY_RE.test(k) ? '[redacted]' : v;
  }
  return out;
}
