import { spawnSync } from 'node:child_process';

import { apiCall, ApiCallError } from '../api-client.js';
import { readCredentials } from '../config.js';
import { readProjectConfig } from '../project-config.js';
import { banner, blankLine, error as printError, step, success } from '../output.js';

interface ShellTokenResponse {
  dsn: string;
  role: string;
  expiresAt: string;
}

export async function runDb(argv: readonly string[]): Promise<number> {
  const [sub] = argv;
  if (!sub || sub === '--help' || sub === '-h') {
    banner('db');
    blankLine();
    step('briven db shell      open psql against your project schema');
    return sub ? 0 : 1;
  }
  if (sub !== 'shell') {
    printError(`unknown db subcommand: ${sub}`);
    return 1;
  }
  return runShell();
}

async function runShell(): Promise<number> {
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

  banner('db shell');
  step(`project   ${local.projectId}`);

  let token: ShellTokenResponse;
  try {
    token = await apiCall<ShellTokenResponse>(`/v1/projects/${local.projectId}/db/shell-token`, {
      method: 'POST',
      apiOrigin: cred.apiOrigin,
      apiKey: cred.apiKey,
    });
  } catch (err) {
    if (err instanceof ApiCallError) {
      printError(`server rejected: ${err.code} (${err.status})`);
    } else {
      printError(err instanceof Error ? err.message : 'unknown error');
    }
    return 1;
  }

  step(`role      ${token.role}`);
  step(`expires   ${formatExpiry(token.expiresAt)}`);
  blankLine();

  const result = spawnSync('psql', [token.dsn], { stdio: 'inherit' });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      printError('psql not found — install the PostgreSQL client tools.');
      step('macOS:  brew install libpq && brew link --force libpq');
      step('Linux:  sudo apt install postgresql-client   (Debian/Ubuntu)');
      return 1;
    }
    printError(result.error.message);
    return 1;
  }
  if (result.status == null) {
    // Signalled exit — treat as abnormal but don't print an error; psql
    // already handed control back to the terminal.
    return 1;
  }
  if (result.status === 0) {
    success('session closed');
  }
  return result.status;
}

function formatExpiry(iso: string): string {
  const then = new Date(iso);
  const mins = Math.max(0, Math.round((then.getTime() - Date.now()) / 60_000));
  return `${then.toISOString().replace('T', ' ').slice(0, 19)}  (in ${mins}m)`;
}
