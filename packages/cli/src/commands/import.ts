import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
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

interface DeploymentResponse {
  deployment: {
    id: string;
    status: string;
    createdAt: string;
  };
}

interface ShellTokenResponse {
  dsn: string;
  role: string;
  expiresAt: string;
}

interface Args {
  path: string | null;
  confirmDestructive: boolean;
  restoreData: boolean;
}

function parse(argv: readonly string[]): Args {
  const out: Args = { path: null, confirmDestructive: false, restoreData: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm-destructive') {
      out.confirmDestructive = true;
    } else if (a === '--restore-data') {
      out.restoreData = true;
    } else if (a === '--help' || a === '-h') {
      out.path = '__HELP__';
    } else if (a && !a.startsWith('--') && !out.path) {
      out.path = a;
    }
  }
  return out;
}

function printUsage(): void {
  banner('import');
  blankLine();
  step('usage: briven import <path> [--confirm-destructive] [--restore-data]');
  step('');
  step('reads a briven-export.json and creates a deployment on the linked');
  step('target project. the linked project is the one in briven.json (or');
  step('the default credential). cross-project imports rewrite the schema,');
  step('which can drop tables — pass --confirm-destructive to allow.');
  step('');
  step('with --restore-data, also pg_restores the sibling <path>.data.dump');
  step('against the target project schema (requires pg_restore on PATH).');
}

export async function runImport(argv: readonly string[]): Promise<number> {
  const args = parse(argv);
  if (args.path === '__HELP__') {
    printUsage();
    return 0;
  }
  if (!args.path) {
    printUsage();
    return 1;
  }

  const local = await readProjectConfig();
  const file = await readCredentials();
  const targetId = local?.projectId ?? file.default;
  if (!targetId) {
    printError('no linked project found — link a destination first.');
    step('run: briven login --project <p_...> --key <brk_...>');
    return 1;
  }
  const cred = file.projects[targetId];
  if (!cred) {
    printError(`no credentials stored for ${targetId}`);
    return 1;
  }

  let payload: ExportPayload;
  try {
    const raw = await readFile(resolve(args.path), 'utf8');
    payload = JSON.parse(raw) as ExportPayload;
  } catch (err) {
    printError(
      `could not read export: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
    return 1;
  }

  if (payload.manifest?.version !== 1) {
    printError(`unsupported export version: ${String(payload.manifest?.version)} (expected 1)`);
    return 1;
  }

  banner('import');
  step(`source    ${payload.manifest.sourceProjectId} (${payload.manifest.sourceProjectName})`);
  step(`exported  ${payload.manifest.exportedAt}`);
  step(`target    ${targetId}`);
  step(`origin    ${cred.apiOrigin}`);
  step(`schema    ${payload.schema ? 'present' : 'absent'}`);
  step(`functions ${Object.keys(payload.functions).length}`);

  const functionNames = Object.keys(payload.functions);

  // The deployments POST already enforces destructive guards on the
  // server — we mirror it as a CLI flag for parity with `briven deploy`.
  // Pass-through: when --confirm-destructive isn't set, the server
  // refuses if the inbound schema would drop a table on the target.
  let res: DeploymentResponse;
  try {
    res = await apiCall<DeploymentResponse>(`/v1/projects/${targetId}/deployments`, {
      method: 'POST',
      apiOrigin: cred.apiOrigin,
      apiKey: cred.apiKey,
      body: {
        schemaSnapshot: payload.schema ?? undefined,
        functionCount: functionNames.length,
        functionNames,
        bundle: payload.functions,
        schemaDiffSummary: { import: 1, source: payload.manifest.sourceProjectId },
      },
    });
  } catch (err) {
    blankLine();
    if (err instanceof ApiCallError) {
      printError(`server rejected: ${err.code} (${err.status})`);
      if (err.code === 'destructive_changes_refused' && !args.confirmDestructive) {
        step('re-run with --confirm-destructive to allow drops on the target');
      }
    } else {
      printError(err instanceof Error ? err.message : 'unknown error');
    }
    return 1;
  }
  blankLine();
  success(`deployment ${res.deployment.id} · ${res.deployment.status}`);

  if (!args.restoreData) return 0;

  // Locate the sibling .data.dump. The export command writes it next to
  // the .json with a stripped extension: foo.briven-export.json →
  // foo.briven-export.data.dump.
  const dumpPath = resolve(args.path).replace(/\.json$/, '') + '.data.dump';
  try {
    await stat(dumpPath);
  } catch {
    printError(`--restore-data set but no sibling dump found at ${dumpPath}`);
    step('re-export with `briven export --with-data` to produce one');
    return 1;
  }
  blankLine();
  step('requesting short-lived dsn for pg_restore');
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
  step(`dsn         expires ${token.expiresAt}`);
  step(`pg_restore ← ${dumpPath}`);
  const code = await runPgRestore(token.dsn, dumpPath);
  if (code !== 0) {
    printError(`pg_restore exited ${code}`);
    step('check pg_restore is on PATH and inspect the output above for details');
    return 1;
  }
  blankLine();
  success('data restored');
  return 0;
}

/**
 * pg_restore from a custom-format dump into a target dsn. --no-owner
 * and --no-privileges so the restore doesn't try to recreate the source
 * roles. --clean drops + recreates objects that exist; the deploy step
 * above already created the schema, so this is largely additive.
 */
function runPgRestore(dsn: string, dumpPath: string): Promise<number> {
  return new Promise((resolveExit) => {
    const child = spawn(
      'pg_restore',
      [
        '--no-owner',
        '--no-privileges',
        '--clean',
        '--if-exists',
        `--dbname=${dsn}`,
        dumpPath,
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
    child.on('exit', (code) => resolveExit(code ?? 1));
    child.on('error', () => resolveExit(127));
  });
}
