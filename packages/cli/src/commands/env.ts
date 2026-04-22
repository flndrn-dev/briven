import { access, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';

import { apiCall, ApiCallError } from '../api-client.js';
import { readCredentials } from '../config.js';
import { readProjectConfig } from '../project-config.js';
import {
  banner,
  blankLine,
  error as printError,
  step,
  success,
} from '../output.js';

interface MaskedEnvVar {
  id: string;
  key: string;
  lastFour: string;
  createdAt: string;
  updatedAt: string;
}

interface AuthCtx {
  projectId: string;
  apiOrigin: string;
  apiKey: string;
}

export async function runEnv(argv: readonly string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === '--help' || sub === '-h') {
    printHelp();
    return sub ? 0 : 1;
  }
  switch (sub) {
    case 'list':
      return runList(rest);
    case 'get':
      return runGet(rest);
    case 'set':
      return runSet(rest);
    case 'delete':
    case 'rm':
      return runDelete(rest);
    case 'pull':
      return runPull(rest);
    default:
      printError(`unknown env subcommand: ${sub}`);
      printHelp();
      return 1;
  }
}

function printHelp(): void {
  banner('env');
  blankLine();
  step('briven env list                     list keys (masked)');
  step('briven env get KEY                  show masked value');
  step('briven env set KEY                  interactive value prompt');
  step('briven env set KEY=value            inline value (logs to shell history)');
  step('briven env delete KEY [--yes]       delete by key');
  step('briven env pull [--out .env.local]  write plaintext to file');
}

async function auth(): Promise<AuthCtx | number> {
  const local = await readProjectConfig();
  if (!local) {
    printError('no briven.json in this directory.');
    step('run: briven init');
    return 1;
  }
  if (!local.projectId) {
    printError('briven.json has no projectId — link this directory first.');
    step('run: briven login --project <id> --key <brk_...>');
    return 1;
  }
  const creds = await readCredentials();
  const cred = creds.projects[local.projectId];
  if (!cred) {
    printError(`no stored credentials for ${local.projectId}.`);
    step('run: briven login --project <id> --key <brk_...>');
    return 1;
  }
  return { projectId: local.projectId, apiOrigin: cred.apiOrigin, apiKey: cred.apiKey };
}

async function runList(_argv: readonly string[]): Promise<number> {
  const ctx = await auth();
  if (typeof ctx === 'number') return ctx;

  banner('env list');
  try {
    const res = await apiCall<{ env: MaskedEnvVar[] }>(
      `/v1/projects/${ctx.projectId}/env`,
      { apiOrigin: ctx.apiOrigin, apiKey: ctx.apiKey },
    );
    blankLine();
    if (res.env.length === 0) {
      step('no env vars set');
      return 0;
    }
    const maxKeyLen = res.env.reduce((m, v) => Math.max(m, v.key.length), 0);
    for (const v of res.env) {
      step(
        `${v.key.padEnd(maxKeyLen)}  ····${v.lastFour}  ${relativeTime(v.updatedAt)}`,
      );
    }
    return 0;
  } catch (err) {
    return apiFail(err, 'list failed');
  }
}

async function runGet(argv: readonly string[]): Promise<number> {
  const ctx = await auth();
  if (typeof ctx === 'number') return ctx;
  const key = argv[0];
  if (!key) {
    printError('missing key — usage: briven env get KEY');
    return 1;
  }

  try {
    const res = await apiCall<{ env: MaskedEnvVar[] }>(
      `/v1/projects/${ctx.projectId}/env`,
      { apiOrigin: ctx.apiOrigin, apiKey: ctx.apiKey },
    );
    const match = res.env.find((v) => v.key === key);
    if (!match) {
      printError(`no env var named '${key}'`);
      return 1;
    }
    banner(`env get ${key}`);
    blankLine();
    step(`value:  ····${match.lastFour}`);
    step(`updated ${relativeTime(match.updatedAt)}`);
    blankLine();
    step(`use 'briven env pull' to fetch plaintext to .env.local`);
    return 0;
  } catch (err) {
    return apiFail(err, 'get failed');
  }
}

async function runSet(argv: readonly string[]): Promise<number> {
  const ctx = await auth();
  if (typeof ctx === 'number') return ctx;
  if (argv.length === 0) {
    printError('missing key — usage: briven env set KEY[=value]');
    return 1;
  }

  const raw = argv[0]!;
  const eqIdx = raw.indexOf('=');
  let key: string;
  let value: string | null;

  if (eqIdx === -1) {
    key = raw;
    value = null;
  } else {
    key = raw.slice(0, eqIdx);
    value = raw.slice(eqIdx + 1);
  }

  if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(key)) {
    printError('key must be uppercase letters, digits, underscores; start with letter or underscore');
    return 1;
  }

  banner(`env set ${key}`);

  if (value === null) {
    try {
      value = await readSecret('        · value: ');
    } catch {
      blankLine();
      printError('cancelled');
      return 1;
    }
    if (!value) {
      printError('empty value — refusing to set');
      return 1;
    }
  } else {
    step('value passed inline; prefer `briven env set KEY` to avoid shell history');
  }

  try {
    await apiCall<{ key: string }>(`/v1/projects/${ctx.projectId}/env`, {
      method: 'PUT',
      apiOrigin: ctx.apiOrigin,
      apiKey: ctx.apiKey,
      body: { key, value },
    });
    blankLine();
    success(`set ${key}`);
    return 0;
  } catch (err) {
    return apiFail(err, 'set failed');
  }
}

async function runDelete(argv: readonly string[]): Promise<number> {
  const ctx = await auth();
  if (typeof ctx === 'number') return ctx;
  const args = parseFlags(argv);
  const key = args._[0];
  if (!key) {
    printError('missing key — usage: briven env delete KEY [--yes]');
    return 1;
  }

  if (!args.yes) {
    const ok = await readYesNo(`        · delete ${key}? [y/N] `);
    if (!ok) {
      step('aborted');
      return 0;
    }
  }

  try {
    await apiCall<{ deleted: string; key: string }>(
      `/v1/projects/${ctx.projectId}/env/by-key/${encodeURIComponent(key)}`,
      { method: 'DELETE', apiOrigin: ctx.apiOrigin, apiKey: ctx.apiKey },
    );
    success(`deleted ${key}`);
    return 0;
  } catch (err) {
    return apiFail(err, 'delete failed');
  }
}

async function runPull(argv: readonly string[]): Promise<number> {
  const ctx = await auth();
  if (typeof ctx === 'number') return ctx;
  const args = parseFlags(argv);
  const out = resolve(process.cwd(), args.out ?? '.env.local');

  banner('env pull');
  step(`target: ${out}`);

  if (!args.force) {
    const existing = await readFile(out, 'utf8').catch((err) => {
      if ((err as { code?: string }).code === 'ENOENT') return null;
      throw err;
    });
    if (existing !== null) {
      printError(`${out} exists — re-run with --force to overwrite`);
      return 1;
    }
  }

  const ignoreCheck = await checkGitignore(out);
  if (ignoreCheck.insideGitRepo && !ignoreCheck.ignored && !args.force) {
    printError(`${out} is inside a git repo but not matched by .gitignore`);
    step(`add this line to .gitignore:`);
    step(`  ${ignoreCheck.suggestedLine}`);
    step('or re-run with --force');
    return 1;
  }

  try {
    const res = await apiCall<{ env: Record<string, string> }>(
      `/v1/projects/${ctx.projectId}/env/plaintext`,
      { apiOrigin: ctx.apiOrigin, apiKey: ctx.apiKey },
    );
    const body = Object.entries(res.env)
      .map(([k, v]) => `${k}=${serialiseValue(v)}`)
      .join('\n');
    await writeFile(out, body.length > 0 ? `${body}\n` : '', { mode: 0o600 });
    blankLine();
    success(`wrote ${Object.keys(res.env).length} vars`);
    return 0;
  } catch (err) {
    return apiFail(err, 'pull failed');
  }
}

function serialiseValue(value: string): string {
  // Only quote when the value has whitespace, quotes, backslashes, or shell
  // metachars that make the `.env.local` unambiguous for dotenv parsers.
  if (/^[A-Za-z0-9_./:@-]*$/.test(value)) return value;
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

async function checkGitignore(
  target: string,
): Promise<{ insideGitRepo: boolean; ignored: boolean; suggestedLine: string }> {
  // Walk up from the target's directory looking for .git; quit at filesystem root.
  let dir = dirname(target);
  let gitRoot: string | null = null;
  for (let i = 0; i < 40; i += 1) {
    const maybe = resolve(dir, '.git');
    const hit = await access(maybe).then(() => true).catch(() => false);
    if (hit) {
      gitRoot = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const filename = target.split('/').pop() ?? '.env.local';
  const suggestedLine = filename;
  if (!gitRoot) {
    return { insideGitRepo: false, ignored: false, suggestedLine };
  }
  const gitignorePath = resolve(gitRoot, '.gitignore');
  const contents = await readFile(gitignorePath, 'utf8').catch(() => '');
  const lines = contents.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  // why: we do a best-effort match on three common patterns — exact name,
  // glob-prefix (`.env*`), and glob-suffix (`*.local`). A proper gitignore
  // matcher would handle nesting, negation, and anchoring; that's overkill
  // for this single-file check.
  const ignored = lines.some(
    (pattern) =>
      pattern === filename ||
      pattern === `/${filename}` ||
      pattern === '.env*' ||
      pattern === '*.local' ||
      pattern === '.env.*',
  );
  return { insideGitRepo: true, ignored, suggestedLine };
}

function parseFlags(argv: readonly string[]): { _: string[]; yes: boolean; force: boolean; out?: string } {
  const out: { _: string[]; yes: boolean; force: boolean; out?: string } = {
    _: [],
    yes: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--force') out.force = true;
    else if (a === '--out') out.out = argv[++i];
    else if (a.startsWith('--out=')) out.out = a.slice('--out='.length);
    else out._.push(a);
  }
  return out;
}

function apiFail(err: unknown, headline: string): number {
  if (err instanceof ApiCallError) {
    printError(`${headline}: ${err.code} (${err.status})`);
  } else {
    printError(err instanceof Error ? err.message : 'unknown error');
  }
  return 1;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const deltaSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (deltaSec < 60) return 'just now';
  if (deltaSec < 3600) return `${Math.round(deltaSec / 60)}m ago`;
  if (deltaSec < 86_400) return `${Math.round(deltaSec / 3600)}h ago`;
  return `${Math.round(deltaSec / 86_400)}d ago`;
}

async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return new Promise((resolvePromise, rejectPromise) => {
      const rl = createInterface({ input: process.stdin });
      rl.once('line', (l) => {
        rl.close();
        resolvePromise(l);
      });
      rl.once('close', () => {
        rejectPromise(new Error('cancelled'));
      });
    });
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolvePromise, rejectPromise) => {
    let buf = '';
    function onData(chunk: Buffer): void {
      const s = chunk.toString('utf8');
      for (const ch of s) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolvePromise(buf);
          return;
        }
        if (ch === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          rejectPromise(new Error('cancelled'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          if (buf.length > 0) buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    }
    function cleanup(): void {
      process.stdin.setRawMode(false);
      process.stdin.removeListener('data', onData);
      process.stdin.pause();
    }
    process.stdin.on('data', onData);
  });
}

async function readYesNo(prompt: string): Promise<boolean> {
  process.stdout.write(prompt);
  return new Promise((resolvePromise) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.once('line', (line) => {
      rl.close();
      const answer = line.trim().toLowerCase();
      resolvePromise(answer === 'y' || answer === 'yes');
    });
  });
}
