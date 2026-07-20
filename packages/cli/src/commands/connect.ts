/**
 * `briven connect` — attach an **existing** cloud project to this folder
 * (sign in → pick project → CLI key → S3 → local wire).
 *
 * Brand-new projects use `briven setup` instead.
 *
 * Subcommands kept for session hygiene:
 *   briven connect status
 *   briven connect logout
 */

import { clearUserCredential, readCredentials, readUserCredential } from '../config.js';
import {
  printConnectProjectHelp,
  runConnectProject,
} from '../setup.js';
import { fetchMe } from '../platform.js';
import {
  banner,
  blankLine,
  error as printError,
  link as printLink,
  step,
  success,
} from '../output.js';
import { ApiCallError } from '../api-client.js';

export async function runConnect(argv: readonly string[]): Promise<number> {
  const [sub] = argv;

  if (sub === '--help' || sub === '-h' || sub === 'help') {
    printConnectProjectHelp();
    return 0;
  }

  if (sub === 'status') {
    return runStatus();
  }

  if (sub === 'logout') {
    return runConnectLogout();
  }

  // Full attach path (also accepts `login` as a no-op alias prefix for --force flows).
  const attachArgv =
    sub === 'login' ? argv.slice(1) : argv;
  return runConnectProject(attachArgv);
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

  blankLine();
  step('attach an existing project to this folder:  briven connect');
  step('create a brand-new project:                 briven setup my-app');
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
