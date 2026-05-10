import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { apiCall, ApiCallError } from '../api-client.js';
import { readCredentials } from '../config.js';
import { readProjectConfig } from '../project-config.js';
import { banner, blankLine, error as printError, step, success } from '../output.js';

interface ExportPayload {
  manifest: {
    version: number;
    sourceProjectId: string;
    sourceProjectName: string;
    sourceDeploymentId: string;
    exportedAt: string;
  };
  schema: Record<string, unknown> | null;
  functions: Record<string, string>;
}

interface ShellTokenResponse {
  dsn: string;
  role: string;
  expiresAt: string;
}

interface Args {
  out: string | null;
  withData: boolean;
}

function parse(argv: readonly string[]): Args {
  const out: Args = { out: null, withData: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) {
      out.out = argv[++i] ?? null;
    } else if (argv[i] === '--with-data') {
      out.withData = true;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      out.out = '__HELP__';
    }
  }
  return out;
}

function printUsage(): void {
  banner('export');
  blankLine();
  step('usage: briven export [--out <path>] [--with-data]');
  step('  --out <path>    destination file (default: <projectId>-<timestamp>.briven-export.json)');
  step('  --with-data     also stream pg_dump of the project schema to <out>.data.dump');
  step('');
  step('without --with-data, exports schema + function source as a single json.');
  step('with --with-data, requires `pg_dump` on PATH and admin-tier credentials');
  step('(briven db shell-token issues a short-lived dsn into the project schema).');
}

export async function runExport(argv: readonly string[]): Promise<number> {
  const args = parse(argv);
  if (args.out === '__HELP__') {
    printUsage();
    return 0;
  }

  const local = await readProjectConfig();
  const file = await readCredentials();
  const targetId = local?.projectId ?? file.default;
  if (!targetId) {
    printError('no linked project found.');
    step('run: briven login --project <p_...> --key <brk_...>');
    return 1;
  }
  const cred = file.projects[targetId];
  if (!cred) {
    printError(`no credentials stored for ${targetId}`);
    return 1;
  }

  banner('export');
  step(`project   ${targetId}`);
  step(`origin    ${cred.apiOrigin}`);

  let payload: ExportPayload;
  try {
    payload = await apiCall<ExportPayload>(`/v1/projects/${targetId}/export`, {
      apiOrigin: cred.apiOrigin,
      apiKey: cred.apiKey,
    });
  } catch (err) {
    blankLine();
    if (err instanceof ApiCallError) {
      printError(`server rejected: ${err.code} (${err.status})`);
    } else {
      printError(err instanceof Error ? err.message : 'unknown error');
    }
    return 1;
  }

  const outPath = args.out
    ? resolve(args.out)
    : resolve(
        `${targetId}-${payload.manifest.exportedAt.replace(/[:.]/g, '-')}.briven-export.json`,
      );
  await writeFile(outPath, JSON.stringify(payload, null, 2), { mode: 0o600 });

  blankLine();
  step(`schema    ${payload.schema ? 'present' : 'absent'}`);
  step(`functions ${Object.keys(payload.functions).length}`);
  step(`wrote     ${outPath}`);

  if (args.withData) {
    const dumpPath = `${outPath.replace(/\.json$/, '')}.data.dump`;
    blankLine();
    step('requesting short-lived dsn for pg_dump');
    let token: ShellTokenResponse;
    try {
      token = await apiCall<ShellTokenResponse>(
        `/v1/projects/${targetId}/db/shell-token`,
        { method: 'POST', apiOrigin: cred.apiOrigin, apiKey: cred.apiKey },
      );
    } catch (err) {
      printError(
        `couldn't issue dsn: ${err instanceof ApiCallError ? `${err.code} (${err.status})` : err instanceof Error ? err.message : 'unknown'}`,
      );
      return 1;
    }
    step(`dsn       expires ${token.expiresAt}`);
    step(`pg_dump → ${dumpPath}`);
    const code = await runPgDump(token.dsn, dumpPath);
    if (code !== 0) {
      printError(`pg_dump exited ${code}`);
      step('check that pg_dump is on PATH and the dsn is reachable from this host');
      return 1;
    }
    step('done');
  }

  blankLine();
  success(args.withData ? 'export + data dump complete' : `wrote ${outPath}`);
  return 0;
}

/**
 * Spawn pg_dump in custom format, write to disk. Inherits stderr so the
 * operator sees pg_dump's own progress. Returns exit code.
 */
function runPgDump(dsn: string, outPath: string): Promise<number> {
  return new Promise((resolveExit) => {
    const child = spawn(
      'pg_dump',
      ['--format=custom', '--compress=6', `--file=${outPath}`, dsn],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
    child.on('exit', (code) => resolveExit(code ?? 1));
    child.on('error', () => resolveExit(127));
  });
}
