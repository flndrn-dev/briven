import { env } from '../env.js';

/**
 * Structured JSON logger. Per CLAUDE.md §5.1:
 * - log structure, never customer content
 * - redact credentials; never log IPs or emails
 * - log shape stays stable so Grafana/Loki queries are cheap
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[env.BRIVEN_LOG_LEVEL]) return;

  const line = {
    level,
    msg,
    ts: new Date().toISOString(),
    service: 'api',
    env: env.BRIVEN_ENV,
    ...fields,
  };

  const channel = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  channel.write(`${JSON.stringify(line)}\n`);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};
