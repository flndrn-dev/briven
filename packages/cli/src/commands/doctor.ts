import pc from 'picocolors';

import { readCredentials } from '../config.js';
import { readProjectConfig } from '../project-config.js';
import { banner, blankLine, error as printError, step, success } from '../output.js';

interface ReadyResponse {
  status: 'ready' | 'not_ready';
  checks: Record<string, 'ok' | 'unreachable' | 'not_configured'>;
}

interface HealthResponse {
  status: string;
  service: string;
  env: string;
  bootedAt: string;
}

interface InfoResponse {
  projectId: string;
  authenticatedVia: 'api_key' | 'session';
  apiKeyId: string | null;
  userId: string | null;
}

export async function runDoctor(argv: readonly string[]): Promise<number> {
  if (argv[0] === '--help' || argv[0] === '-h') {
    banner('doctor');
    blankLine();
    step('briven doctor                end-to-end health check against the linked api');
    step('briven doctor --origin URL   override the api origin (skip stored creds)');
    return 0;
  }

  const flag = argv.findIndex((a) => a === '--origin');
  const cliOrigin = flag !== -1 && flag + 1 < argv.length ? argv[flag + 1] : undefined;

  banner('doctor');
  blankLine();

  let origin: string | null = cliOrigin ?? null;
  let projectId: string | null = null;
  let apiKey: string | null = null;

  if (!origin) {
    const local = await readProjectConfig();
    if (local) {
      check(
        'briven.json',
        'ok',
        `name=${local.name ?? '<unset>'} projectId=${local.projectId ?? '<unset>'}`,
      );
      projectId = local.projectId ?? null;
    } else {
      check('briven.json', 'warn', 'not found in cwd — running stack-only checks');
    }
    if (projectId) {
      const creds = await readCredentials();
      const cred = creds.projects[projectId];
      if (cred) {
        origin = cred.apiOrigin;
        apiKey = cred.apiKey;
        check('credentials', 'ok', `origin=${cred.apiOrigin}`);
      } else {
        check('credentials', 'warn', `no api key for ${projectId}`);
      }
    }
  } else {
    check('credentials', 'ok', `using --origin ${origin}`);
  }

  if (!origin) {
    blankLine();
    printError('no api origin to test — link a project or pass --origin <url>.');
    return 1;
  }

  // Process liveness — must be ok or the host is dead.
  const health = await fetchJson<HealthResponse>(`${origin}/health`);
  if (!health.ok) {
    check('api/health', 'fail', health.error);
  } else {
    check(
      'api/health',
      'ok',
      `${health.body.service} env=${health.body.env} booted=${formatBoot(health.body.bootedAt)}`,
    );
  }

  // Dependency readiness — surfaces every sub-status.
  const ready = await fetchJson<ReadyResponse>(`${origin}/ready`);
  if (!ready.ok) {
    check('api/ready', 'fail', ready.error);
  } else {
    const overall = ready.body.status === 'ready' ? 'ok' : 'fail';
    check('api/ready', overall, ready.body.status);
    for (const [name, state] of Object.entries(ready.body.checks)) {
      const lvl = state === 'ok' ? 'ok' : state === 'not_configured' ? 'warn' : 'fail';
      check(`  ${name}`, lvl, state);
    }
  }

  // Realtime is on a sibling subdomain; derive it from the api origin when
  // the api host starts with "api.". For dev/local origins we skip this
  // because there's nothing to derive.
  const realtimeOrigin = origin.replace(/:\/\/api\./, '://realtime.');
  if (realtimeOrigin !== origin) {
    const rt = await fetchJson<{ status: string }>(`${realtimeOrigin}/health`);
    if (!rt.ok) check('realtime/health', 'warn', rt.error);
    else check('realtime/health', 'ok', rt.body.status ?? 'ok');
  }

  // If we have stored creds, confirm the api accepts the key. /info is the
  // dedicated whoami endpoint; it returns 401 if the key is wrong.
  if (apiKey && projectId) {
    const auth = await fetchJson<InfoResponse>(`${origin}/v1/projects/${projectId}/info`, apiKey);
    if (!auth.ok) {
      check('auth (api key)', 'fail', auth.error);
    } else if (auth.body.projectId === projectId) {
      check('auth (api key)', 'ok', `via=${auth.body.authenticatedVia}`);
    } else {
      check('auth (api key)', 'warn', 'unexpected response shape');
    }
  }

  blankLine();
  if (errors > 0) {
    printError(`${errors} check${errors === 1 ? '' : 's'} failed`);
    return 1;
  }
  if (warnings > 0) {
    success(`required checks ok (${warnings} warning${warnings === 1 ? '' : 's'})`);
    return 0;
  }
  success('all checks ok');
  return 0;
}

let warnings = 0;
let errors = 0;

function check(name: string, level: 'ok' | 'warn' | 'fail', detail: string): void {
  const tag =
    level === 'ok'
      ? pc.green('ok  ')
      : level === 'warn'
        ? pc.yellow('warn')
        : pc.red('fail');
  if (level === 'warn') warnings += 1;
  if (level === 'fail') errors += 1;
  step(`${tag}  ${name.padEnd(22)} ${pc.dim(detail)}`);
}

interface ApiOk<T> {
  ok: true;
  body: T;
}
interface ApiErr {
  ok: false;
  error: string;
}

async function fetchJson<T>(url: string, apiKey?: string): Promise<ApiOk<T> | ApiErr> {
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    const text = await res.text();
    if (res.status === 401) return { ok: false, error: 'unauthorized (401)' };
    if (res.status === 403) return { ok: false, error: 'forbidden (403)' };
    if (res.status === 404) return { ok: false, error: 'not found (404)' };
    // /ready returns 503 when not ready; we still want the parsed body.
    if (!text) return { ok: false, error: `http ${res.status} empty body` };
    try {
      return { ok: true, body: JSON.parse(text) as T };
    } catch {
      return { ok: false, error: `non-json response (${res.status})` };
    }
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        return { ok: false, error: 'timeout (5s)' };
      }
      return { ok: false, error: err.message };
    }
    return { ok: false, error: 'unknown' };
  }
}

function formatBoot(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const sec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.round(sec / 3600)}h ago`;
}
