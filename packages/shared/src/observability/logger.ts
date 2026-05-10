import { redactValue } from './redaction.js';

/**
 * Structured JSON logger shared across briven services.
 *
 * Emits one JSON line per call to stdout (info/debug) or stderr (warn/error).
 * Every string in the message and the `fields` object is run through the
 * redaction pass before serialisation, so emails and IPv4 addresses can't
 * accidentally end up in Loki — even if a caller forgets to redact at the
 * call site (CLAUDE.md §5.1).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerOptions {
  service: string;
  env: string;
  level: LogLevel;
}

export interface Logger {
  debug: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
}

/**
 * Walk a value tree and apply redaction to every string. Objects and
 * arrays are rebuilt; scalars other than strings pass through unchanged.
 * Bounded depth to refuse pathological input (cycles, deeply nested
 * customer-supplied objects); past the cap we replace with a sentinel
 * rather than infinite-recursing.
 */
const REDACT_DEPTH_LIMIT = 16;

function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > REDACT_DEPTH_LIMIT) return '[REDACTED:depth-exceeded]';
  if (typeof value === 'string') return redactValue(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function createLogger(options: LoggerOptions): Logger {
  const minLevel = LEVEL_ORDER[options.level];

  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < minLevel) return;
    const redactedFields = fields
      ? (redactDeep(fields) as Record<string, unknown>)
      : undefined;
    const line = {
      level,
      msg: redactValue(msg),
      ts: new Date().toISOString(),
      service: options.service,
      env: options.env,
      ...redactedFields,
    };
    const channel = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    channel.write(`${JSON.stringify(line)}\n`);
  };

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}
