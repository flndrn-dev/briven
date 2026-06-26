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

type ExportTarget = 'briven' | 'convex' | 'supabase' | 'postgres-sql';

interface Args {
  out: string | null;
  withData: boolean;
  target: ExportTarget;
}

function parse(argv: readonly string[]): Args {
  const out: Args = { out: null, withData: false, target: 'briven' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) {
      out.out = argv[++i] ?? null;
    } else if (argv[i] === '--with-data') {
      out.withData = true;
    } else if (argv[i] === '--target' && argv[i + 1]) {
      out.target = argv[++i] as ExportTarget;
    } else if (argv[i]?.startsWith('--target=')) {
      out.target = argv[i]!.slice('--target='.length) as ExportTarget;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      out.out = '__HELP__';
    }
  }
  return out;
}

function printUsage(): void {
  banner('export');
  blankLine();
  step('usage: briven export [--out <path>] [--with-data] [--target <name>]');
  step('  --out <path>     destination file (default: <projectId>-<timestamp>.briven-export.json)');
  step('  --with-data      also stream pg_dump of the project database to <out>.data.dump');
  step('  --target <name>  output shape — briven (default) | convex | supabase | postgres-sql');
  step('');
  step('targets:');
  step('  briven         briven-native bundle (json). this is the format briven import reads.');
  step('  convex         emit convex/schema.ts + convex/<name>.ts files in a directory.');
  step('  supabase       emit supabase/migrations/<ts>_init.sql + supabase/functions/<name>/.');
  step('  postgres-sql   emit a single .sql file with CREATE TABLE statements only.');
  step('');
  step('non-briven targets are reverse-direction parity — you can leave briven any day.');
  step('migrating TO briven? see https://briven.tech/migrate.');
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

  // Non-default targets are reverse-direction parity. We don't implement
  // them fully today — the briven export bundle is the source of truth,
  // and the target adapters land per-source as customers ask for them.
  // The flag exists now so the surface is documented, the CLI knows
  // about it, and the migration story includes "you can leave any day".
  if (args.target !== 'briven') {
    blankLine();
    step(`target    ${args.target}`);
    step(`schema    ${payload.schema ? 'present' : 'absent'}`);
    step(`functions ${Object.keys(payload.functions).length}`);
    blankLine();
    printError(
      `--target=${args.target} is on the roadmap but not yet implemented.`,
    );
    step('your data is safe — briven export with no --target writes the briven-native bundle.');
    step('to leave briven today: run `briven export --with-data` and operate on the .json + .data.dump yourself.');
    step('priority order for adapters is driven by demand — file an issue at code.konnos.org/flndrn/briven if you need one urgently.');
    return 2;
  }

  const outPath = args.out
    ? resolve(args.out)
    : resolve(
        `${targetId}-${payload.manifest.exportedAt.replace(/[:.]/g, '-')}.briven-export.json`,
      );
  await writeFile(outPath, JSON.stringify(payload, null, 2), { mode: 0o600 });

  blankLine();
  step(`target    ${args.target}`);
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
