import { readCredentials, writeCredentials } from '../config.js';
import { banner, blankLine, error as printError, step, success } from '../output.js';

/**
 * Lists projects authenticated on this machine + sets the default that
 * other commands fall back to when no `briven.json` is present.
 *
 * Note: this command works against the local credentials file, not the
 * server. Listing every project a user owns would need a session-bearing
 * auth path (the CLI today uses per-project `brk_…` keys, which are
 * project-scoped by design). Server-backed listing arrives with the
 * device-code OAuth path.
 */

function printUsage(): void {
  banner('projects');
  blankLine();
  step('usage:');
  step('  briven projects list                  list projects authenticated on this machine');
  step('  briven projects set-default <p_...>   set the default project for cli commands');
}

export async function runProjects(argv: readonly string[]): Promise<number> {
  const [sub, ...rest] = argv;

  if (!sub || sub === '--help' || sub === '-h' || sub === 'help') {
    printUsage();
    return sub ? 0 : 1;
  }

  if (sub === 'list') {
    return listProjects();
  }

  if (sub === 'set-default') {
    const targetId = rest[0];
    if (!targetId) {
      printError('usage: briven projects set-default <projectId>');
      return 1;
    }
    return setDefault(targetId);
  }

  printError(`unknown subcommand: ${sub}`);
  step("run 'briven projects --help' for usage");
  return 1;
}

async function listProjects(): Promise<number> {
  const file = await readCredentials();
  const ids = Object.keys(file.projects);

  banner('projects');
  blankLine();

  if (ids.length === 0) {
    step('no projects authenticated on this machine.');
    step('run: briven login --project <p_...> --key <brk_...>');
    return 0;
  }

  step(`${ids.length} project${ids.length === 1 ? '' : 's'} authenticated:`);
  for (const id of ids.sort()) {
    const cred = file.projects[id]!;
    const isDefault = file.default === id;
    const marker = isDefault ? '*' : ' ';
    step(
      `  ${marker} ${id}  ·  ${cred.apiOrigin}  ·  key …${cred.suffix}`,
    );
  }
  if (file.default) {
    blankLine();
    step(`default: ${file.default}`);
  }
  return 0;
}

async function setDefault(targetId: string): Promise<number> {
  const file = await readCredentials();
  if (!file.projects[targetId]) {
    printError(`no credentials stored for ${targetId}`);
    step(`run: briven login --project ${targetId} --key <brk_...>`);
    return 1;
  }
  file.default = targetId;
  await writeCredentials(file);
  success(`default project set to ${targetId}`);
  return 0;
}
