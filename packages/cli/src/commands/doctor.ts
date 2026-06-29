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

interface BuildInfoResponse {
  service: string;
  env: string;
  buildSha: string;
  buildAt: string;
  bootedAt: string;
  uptimeSec: number;
  domain: string | null;
}

interface AuthInfoResponse {
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
    step('briven doctor --json         machine-readable output (for scripts and CI)');
    return 0;
  }

  // Per-call state. Kept as locals (not module-level) so concurrent /
  // repeated runDoctor() calls in the same process — e.g. parallel test
  // runs — never clobber each other's counters.
  let warnings = 0;
  let errors = 0;
  const checks: CheckRow[] = [];
  const jsonMode = argv.includes('--json');

  function check(name: string, level: 'ok' | 'warn' | 'fail', detail: string): void {
    if (level === 'warn') warnings += 1;
    if (level === 'fail') errors += 1;
    checks.push({ name: name.trim(), level, detail });

    if (jsonMode) return;

    const tag =
      level === 'ok'
        ? pc.green('ok  ')
        : level === 'warn'
          ? pc.yellow('warn')
          : pc.red('fail');
    step(`${tag}  ${name.padEnd(22)} ${pc.dim(detail)}`);
  }

  const flag = argv.findIndex((a) => a === '--origin');
  const cliOrigin = flag !== -1 && flag + 1 < argv.length ? argv[flag + 1] : undefined;

  if (!jsonMode) {
    banner('doctor');
    blankLine();
  }

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
    if (jsonMode) {
      process.stdout.write(
        JSON.stringify({ ok: false, error: 'no_api_origin', checks }, null, 2) + '\n',
      );
      return 1;
    }
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

  // Build identity — non-fatal if missing (older deploys, dev mode).
  const info = await fetchJson<BuildInfoResponse>(`${origin}/info`);
  if (info.ok) {
    const sha = info.body.buildSha.slice(0, 12);
    const uptime = formatUptime(info.body.uptimeSec);
    check('api/info', 'ok', `build=${sha} built=${info.body.buildAt} up=${uptime}`);
  } else {
    check('api/info', 'warn', `unavailable (${info.error})`);
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
    const auth = await fetchJson<AuthInfoResponse>(`${origin}/v1/projects/${projectId}/info`, apiKey);
    if (!auth.ok) {
      check('auth (api key)', 'fail', auth.error);
    } else if (auth.body.projectId === projectId) {
      check('auth (api key)', 'ok', `via=${auth.body.authenticatedVia}`);
    } else {
      check('auth (api key)', 'warn', 'unexpected response shape');
    }
  }

  if (jsonMode) {
    const okFlag = errors === 0;
    const buildSha = info.ok ? info.body.buildSha : null;
    const buildAt = info.ok ? info.body.buildAt : null;
    process.stdout.write(
      JSON.stringify(
        {
          ok: okFlag,
          origin,
          buildSha,
          buildAt,
          warnings,
          errors,
          checks,
        },
        null,
        2,
      ) + '\n',
    );
    return okFlag ? 0 : 1;
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

interface CheckRow {
  name: string;
  level: 'ok' | 'warn' | 'fail';
  detail: string;
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

function formatUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '?';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}
