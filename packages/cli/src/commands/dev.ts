import chokidar from 'chokidar';
import pc from 'picocolors';

import { diff, type SchemaDef } from '@briven/schema';

import { apiCall, ApiCallError } from '../api-client.js';
import { discoverFunctions, loadProjectSchema } from '../bundler.js';
import { readCredentials, type ProjectCredential } from '../config.js';
import { readProjectConfig } from '../project-config.js';
import { banner, blankLine, error as printError, step, success } from '../output.js';

interface DevArgs {
  quiet: boolean;
  confirmDestructive: boolean;
}

interface Snapshot {
  schema: SchemaDef | null;
  bundle: Readonly<Record<string, string>>;
}

export async function runDev(argv: readonly string[]): Promise<number> {
  const args = parseFlags(argv);

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

  banner(`dev ${local.projectId}`);
  step(`origin    ${cred.apiOrigin}`);
  step(
    args.confirmDestructive
      ? pc.red('destructive schema diffs allowed')
      : 'safe mode — destructive schema diffs refused',
  );
  blankLine();

  const cwd = process.cwd();
  const snapshot: Snapshot = { schema: null, bundle: {} };
  let pushing = false;
  let pending = false;
  let debounce: NodeJS.Timeout | null = null;

  const watcher = chokidar.watch(['briven/schema.ts', 'briven/functions/**/*.ts'], {
    cwd,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 50 },
  });

  const trigger = (): void => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      if (pushing) {
        pending = true;
        return;
      }
      pushing = true;
      void push(cwd, local.projectId!, cred, snapshot, args)
        .catch((err: unknown) => {
          printError(err instanceof Error ? err.message : 'unknown error');
        })
        .finally(() => {
          pushing = false;
          if (pending) {
            pending = false;
            trigger();
          }
        });
    }, 300);
  };

  watcher.on('add', trigger);
  watcher.on('change', trigger);
  watcher.on('unlink', trigger);

  // Optional log stream — run in parallel. Don't await; let it loop.
  if (!args.quiet) {
    void streamLogs(cred, local.projectId);
  }

  step(pc.dim('watching briven/schema.ts and briven/functions/**/*.ts'));
  blankLine();

  await new Promise<void>((resolve) => {
    const cleanup = (): void => {
      void watcher.close().finally(() => resolve());
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  });

  blankLine();
  success('stopped');
  return 0;
}

async function push(
  cwd: string,
  projectId: string,
  cred: ProjectCredential,
  snapshot: Snapshot,
  args: DevArgs,
): Promise<void> {
  const nextSchema = await loadProjectSchema(cwd);
  const next = await discoverFunctions(cwd);
  const nextBundle = next.bundle;

  const schemaChanged = !sameSchema(snapshot.schema, nextSchema);
  const { changedFunctions, removedFunctions } = bundleDelta(snapshot.bundle, nextBundle);

  if (
    !schemaChanged &&
    Object.keys(changedFunctions).length === 0 &&
    removedFunctions.length === 0
  ) {
    return; // nothing to push
  }

  if (schemaChanged && nextSchema) {
    const result = diff(snapshot.schema, nextSchema);
    if (result.destructive && !args.confirmDestructive) {
      step(pc.red('destructive schema diff detected — refusing to push'));
      for (const c of result.changes) {
        if (c.kind === 'drop_table') step(`  - table ${c.table}`);
        else if (c.kind === 'drop_column') step(`  - ${c.table}.${c.column}`);
      }
      step(pc.dim('re-run briven dev --confirm-destructive, or fix briven/schema.ts'));
      return;
    }
  }

  const body: Record<string, unknown> = {};
  if (Object.keys(changedFunctions).length > 0) body.changedFunctions = changedFunctions;
  if (removedFunctions.length > 0) body.removedFunctions = removedFunctions;
  if (schemaChanged && nextSchema) body.schemaSnapshot = nextSchema;
  if (args.confirmDestructive) body.confirmDestructive = true;

  const started = Date.now();
  try {
    const res = await apiCall<{
      deployment: { id: string; status: string };
    }>(`/v1/projects/${projectId}/deployments/latest`, {
      method: 'PATCH',
      apiOrigin: cred.apiOrigin,
      apiKey: cred.apiKey,
      body,
    });
    const clock = new Date().toISOString().slice(11, 19);
    step(
      `${clock}  ${pc.dim('pushed')} ${res.deployment.id}  ${pc.green(res.deployment.status)}  ${
        Date.now() - started
      }ms`,
    );
    snapshot.schema = nextSchema;
    snapshot.bundle = nextBundle;
  } catch (err) {
    if (err instanceof ApiCallError) {
      printError(`push failed: ${err.code} (${err.status})`);
    } else {
      printError(err instanceof Error ? err.message : 'unknown error');
    }
  }
}

function bundleDelta(
  prev: Readonly<Record<string, string>>,
  next: Readonly<Record<string, string>>,
): { changedFunctions: Record<string, string>; removedFunctions: string[] } {
  const changed: Record<string, string> = {};
  const removed: string[] = [];
  for (const [k, v] of Object.entries(next)) {
    if (prev[k] !== v) changed[k] = v;
  }
  for (const k of Object.keys(prev)) {
    if (!(k in next)) removed.push(k);
  }
  return { changedFunctions: changed, removedFunctions: removed };
}

function sameSchema(a: SchemaDef | null, b: SchemaDef | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  // Fast structural compare via JSON — SchemaDef is plain data.
  return JSON.stringify(a) === JSON.stringify(b);
}

async function streamLogs(cred: ProjectCredential, projectId: string): Promise<void> {
  const url = `${cred.apiOrigin}/v1/projects/${projectId}/logs/stream`;
  let backoff = 1_000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(url, {
        headers: { accept: 'text/event-stream', authorization: `Bearer ${cred.apiKey}` },
      });
      if (!res.ok || !res.body) {
        throw new Error(`logs stream ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const msg = parseSseBlock(block);
          if (!msg || msg.event === 'ping' || !msg.data) continue;
          try {
            renderInvocation(JSON.parse(msg.data) as Record<string, string>);
          } catch {
            // ignore malformed frame
          }
        }
      }
      backoff = 1_000;
    } catch {
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 10_000);
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
}

function renderInvocation(raw: Record<string, string>): void {
  const ts = raw.ts ? new Date(raw.ts) : new Date();
  const clock = ts.toISOString().slice(11, 19);
  const status = raw.status === 'ok' ? pc.green('ok ') : pc.red('err');
  const duration = `${raw.durationMs ?? '0'}ms`;
  const name = (raw.functionName ?? '<unknown>').padEnd(22);
  step(`${clock}  ${name}  ${status}  ${duration}`);

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

function parseFlags(argv: readonly string[]): DevArgs {
  const out: DevArgs = { quiet: false, confirmDestructive: false };
  for (const a of argv) {
    if (a === '--quiet' || a === '-q') out.quiet = true;
    else if (a === '--confirm-destructive') out.confirmDestructive = true;
  }
  return out;
}
