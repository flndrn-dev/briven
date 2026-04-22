import pc from 'picocolors';

import { ApiCallError } from '../api-client.js';
import { readCredentials } from '../config.js';
import { readProjectConfig } from '../project-config.js';
import { banner, blankLine, error as printError, step, success } from '../output.js';

interface StreamOptions {
  tail: boolean;
  n: number;
  sinceMs: number | null;
}

export async function runLogs(argv: readonly string[]): Promise<number> {
  if (argv[0] === '--help' || argv[0] === '-h') {
    printHelp();
    return 0;
  }
  const opts = parseFlags(argv);
  if (!opts.tail) {
    // No other modes yet — tail is the default behaviour.
    opts.tail = true;
  }

  const local = await readProjectConfig();
  if (!local) {
    printError('no briven.json in this directory.');
    step('run: briven init');
    return 1;
  }
  if (!local.projectId) {
    printError('briven.json has no projectId — link this directory first.');
    return 1;
  }
  const creds = await readCredentials();
  const cred = creds.projects[local.projectId];
  if (!cred) {
    printError(`no stored credentials for ${local.projectId}.`);
    return 1;
  }

  banner(`logs ${local.projectId}`);
  blankLine();

  const qs = new URLSearchParams();
  if (opts.sinceMs !== null) {
    // Redis stream ids are `<ms>-<seq>`; clamping seq to 0 makes XRANGE
    // inclusive from that wall-clock.
    const sinceId = `${Date.now() - opts.sinceMs}-0`;
    qs.set('since', sinceId);
  } else if (opts.n > 0) {
    qs.set('n', String(opts.n));
  }

  const url = `${cred.apiOrigin}/v1/projects/${local.projectId}/logs/stream${
    qs.toString() ? `?${qs.toString()}` : ''
  }`;

  let backoff = 1_000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await streamOnce(url, cred.apiKey);
      // Server closed cleanly — rare; reconnect with short delay.
      await sleep(500);
      backoff = 1_000;
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 429) {
        printError('rate limited — too many concurrent log streams on this project');
        return 1;
      }
      const message = err instanceof Error ? err.message : String(err);
      step(pc.dim(`log stream lost: ${message}; reconnecting in ${backoff / 1000}s`));
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 10_000);
    }
  }
}

function printHelp(): void {
  banner('logs');
  blankLine();
  step('briven logs                    stream new function invocation logs');
  step('briven logs --tail             same as above');
  step('briven logs --tail -n 50       replay last 50, then follow');
  step('briven logs --since 10m        replay last 10 minutes, then follow');
}

function parseFlags(argv: readonly string[]): StreamOptions {
  const out: StreamOptions = { tail: false, n: 0, sinceMs: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === '--tail') out.tail = true;
    else if (a === '-n') out.n = Number(argv[++i] ?? '0');
    else if (a.startsWith('-n=')) out.n = Number(a.slice(3));
    else if (a === '--since') out.sinceMs = parseDuration(argv[++i] ?? '');
    else if (a.startsWith('--since=')) out.sinceMs = parseDuration(a.slice('--since='.length));
  }
  return out;
}

function parseDuration(raw: string): number | null {
  if (!raw) return null;
  const m = raw.match(/^(\d+)(s|m|h)$/);
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2]) {
    case 's':
      return n * 1_000;
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 3_600_000;
    default:
      return null;
  }
}

async function streamOnce(url: string, apiKey: string): Promise<void> {
  const res = await fetch(url, {
    headers: {
      accept: 'text/event-stream',
      authorization: `Bearer ${apiKey}`,
    },
  });
  if (!res.ok) {
    throw new ApiCallError(res.status, 'http_error', await res.text().catch(() => res.statusText));
  }
  if (!res.body) {
    throw new Error('empty response body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const msg = parseSseBlock(raw);
      if (!msg || msg.event === 'ping') continue;
      if (!msg.data) continue;
      try {
        const parsed = JSON.parse(msg.data) as Record<string, string>;
        renderInvocation(parsed);
      } catch {
        // malformed line — skip
      }
    }
  }
}

function parseSseBlock(block: string): { event?: string; data?: string } | null {
  const out: { event?: string; data?: string } = {};
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon);
    let value = line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') out.event = value;
    else if (field === 'data') out.data = (out.data ?? '') + value;
  }
  return out;
}

interface UserLog {
  level: string;
  message: string;
  fieldsJson?: string;
  ts: string;
}

function renderInvocation(raw: Record<string, string>): void {
  const ts = raw.ts ? new Date(raw.ts) : new Date();
  const clock = ts.toISOString().slice(11, 19);
  const status = raw.status === 'ok' ? pc.green('ok ') : pc.red('err');
  const duration = `${raw.durationMs ?? '0'}ms`;
  const name = raw.functionName ?? '<unknown>';
  step(`${clock}  ${name.padEnd(22)}  ${status}  ${duration}`);

  let userLogs: UserLog[] = [];
  try {
    userLogs = JSON.parse(raw.logs ?? '[]') as UserLog[];
  } catch {
    // ignore
  }
  for (const entry of userLogs) {
    const label = entry.level === 'error' ? pc.red('err') : pc.dim('log');
    step(`                  ${pc.dim('↳')} ${label}  ${entry.message}`);
  }
  if (raw.status !== 'ok' && raw.errMessage) {
    step(`                  ${pc.dim('↳')} ${pc.red('err')}  ${raw.errMessage}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reference `success` to satisfy linters in future extensions — kept out
// of the main path deliberately (we never "finish" tailing).
void success;
