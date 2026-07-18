/**
 * `briven connect` — link this machine to the Briven platform.
 *
 * Opens a browser for OAuth, stores a user session under
 * ~/.config/briven/credentials.json, and shows how to continue with
 * project create / use / link. Project keys stay separate (see
 * `briven projects` and `briven login`).
 */

import { clearUserCredential, readCredentials, readUserCredential } from '../config.js';
import { resolveOrigins } from '../origins.js';
import {
  ensurePlatformSession,
  fetchMe,
  listRemoteProjects,
  printRemoteProjects,
} from '../platform.js';
import {
  banner,
  blankLine,
  error as printError,
  link as printLink,
  step,
  success,
} from '../output.js';
import { ApiCallError } from '../api-client.js';

function printUsage(): void {
  banner('connect');
  blankLine();
  step('usage:');
  step('  briven connect              sign in to the platform (browser OAuth)');
  step('  briven connect status       show platform session + local projects');
  step('  briven connect logout       forget platform session (keep project keys)');
  blankLine();
  step('project lifecycle after connect:');
  step('  briven projects list --remote');
  step('  briven projects create --name my-app');
  step('  briven projects use <p_...>');
  step('  briven link                 (bind this folder to a project)');
  blankLine();
  step('docs: https://docs.briven.tech/connect');
}

function parseForce(argv: readonly string[]): boolean {
  return argv.includes('--force') || argv.includes('-f');
}

export async function runConnect(argv: readonly string[]): Promise<number> {
  const [sub, ...rest] = argv;

  if (sub === '--help' || sub === '-h' || sub === 'help') {
    printUsage();
    return 0;
  }

  if (sub === 'status') {
    return runStatus();
  }

  if (sub === 'logout') {
    return runConnectLogout();
  }

  // Default: sign in (or re-auth with --force). Extra unknown words → help.
  if (sub && !sub.startsWith('-') && sub !== 'login') {
    printError(`unknown subcommand: ${sub}`);
    step("run 'briven connect --help' for usage");
    return 1;
  }

  const force = parseForce(sub === 'login' ? rest : argv);
  return runSignIn(force);
}

async function runSignIn(force: boolean): Promise<number> {
  const origins = resolveOrigins();
  try {
    banner('connect');
    blankLine();
    step(force ? 're-authorizing in the browser…' : 'checking platform session…');
    const user = await ensurePlatformSession({ force, quiet: true, origins });
    const me = await fetchMe(user.apiOrigin, user.token);

    success(`signed in as ${me.email}`);
    step(`user id   ${me.id}`);
    step(`api       ${user.apiOrigin}`);

    const remote = await listRemoteProjects(user.apiOrigin, user.token);
    blankLine();
    printRemoteProjects(remote);

    const local = await readCredentials();
    const localCount = Object.keys(local.projects).length;
    blankLine();
    step(
      localCount === 0
        ? 'no project keys on this machine yet.'
        : `${localCount} project key${localCount === 1 ? '' : 's'} stored locally.`,
    );
    if (local.default) step(`default project: ${local.default}`);

    blankLine();
    step('next:');
    step('  briven projects create --name my-app   create a project + mint a cli key');
    step('  briven projects use <p_...>            use an existing project');
    step('  briven init && briven link             scaffold + bind this folder');
    printLink('https://docs.briven.tech/connect');
    return 0;
  } catch (err) {
    if (err instanceof ApiCallError) {
      printError(`connect failed: ${err.code} (${err.status})`);
    } else {
      printError(err instanceof Error ? err.message : 'connect failed');
    }
    return 1;
  }
}

async function runStatus(): Promise<number> {
  banner('connect status');
  blankLine();

  const user = await readUserCredential();
  if (!user) {
    step('platform: not signed in');
    step('run: briven connect');
  } else {
    try {
      const me = await fetchMe(user.apiOrigin, user.token);
      success(`platform: signed in as ${me.email}`);
      step(`user id   ${me.id}`);
      step(`api       ${user.apiOrigin}`);
      step(`saved at  ${user.savedAt}`);
    } catch (err) {
      if (err instanceof ApiCallError) {
        printError(`platform: session invalid (${err.code})`);
      } else {
        printError(err instanceof Error ? err.message : 'platform: session check failed');
      }
      step('run: briven connect');
    }
  }

  const local = await readCredentials();
  const ids = Object.keys(local.projects);
  blankLine();
  if (ids.length === 0) {
    step('local projects: none');
  } else {
    step(`local projects: ${ids.length}`);
    for (const id of ids.sort()) {
      const c = local.projects[id]!;
      const marker = local.default === id ? '*' : ' ';
      step(`  ${marker} ${id}  ····${c.suffix}`);
    }
    if (local.default) step(`default: ${local.default}`);
  }

  printLink('https://docs.briven.tech/connect');
  return 0;
}

async function runConnectLogout(): Promise<number> {
  banner('connect logout');
  const user = await readUserCredential();
  if (!user) {
    step('no platform session stored');
    return 0;
  }
  await clearUserCredential();
  success('platform session cleared (project keys kept)');
  step('to wipe project keys too: briven logout');
  return 0;
}
