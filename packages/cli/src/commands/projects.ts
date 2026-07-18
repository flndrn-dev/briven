import { basename } from 'node:path';

import { ApiCallError } from '../api-client.js';
import {
  readCredentials,
  writeCredentials,
  type CredentialsFile,
} from '../config.js';
import { resolveOrigins } from '../origins.js';
import {
  createRemoteProject,
  ensurePlatformSession,
  listRemoteProjects,
  mintAndStoreKey,
  printRemoteProjects,
  printSessionExpiredHint,
} from '../platform.js';
import { readProjectConfig, writeProjectConfig } from '../project-config.js';
import { REGIONS } from '../regions.js';
import { banner, blankLine, error as printError, step, success } from '../output.js';

/**
 * Project lifecycle from the shell.
 *
 * Local (no platform session):
 *   list / set-default / unlink  — credentials.json only
 *
 * Remote (needs `briven connect`):
 *   list --remote / create / use — control plane + mint CLI keys
 */

function printUsage(): void {
  banner('projects');
  blankLine();
  step('usage:');
  step('  briven projects list [--remote]           local keys, or account projects');
  step('  briven projects create --name <name>      create on platform + mint cli key');
  step('      [--region <id>] [--slug <slug>] [--no-use]');
  step('  briven projects use <p_...>               mint/store key + set default');
  step('      [--link]                              also write projectId into briven.json');
  step('  briven projects unlink <p_...>            drop local key for a project');
  step('  briven projects set-default <p_...>       set default for other commands');
  blankLine();
  step('platform session required for --remote / create / use:');
  step('  briven connect');
  blankLine();
  step('regions:');
  for (const r of REGIONS) {
    step(`  ${r.id}  — ${r.label}`);
  }
}

function hasFlag(argv: readonly string[], name: string): boolean {
  return argv.includes(name);
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === name && argv[i + 1]) return argv[i + 1];
    if (arg?.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}

export async function runProjects(argv: readonly string[]): Promise<number> {
  const [sub, ...rest] = argv;

  if (!sub || sub === '--help' || sub === '-h' || sub === 'help') {
    printUsage();
    return sub ? 0 : 1;
  }

  if (sub === 'list') {
    return listProjects(rest);
  }
  if (sub === 'create') {
    return createProject(rest);
  }
  if (sub === 'use') {
    return useProject(rest);
  }
  if (sub === 'unlink') {
    const targetId = rest[0];
    if (!targetId || targetId.startsWith('-')) {
      printError('usage: briven projects unlink <projectId>');
      return 1;
    }
    return unlinkProject(targetId);
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

async function listProjects(argv: readonly string[]): Promise<number> {
  const remote = hasFlag(argv, '--remote') || hasFlag(argv, '-r');

  if (remote) {
    banner('projects (remote)');
    blankLine();
    try {
      const user = await ensurePlatformSession({ quiet: true });
      const projects = await listRemoteProjects(user.apiOrigin, user.token);
      printRemoteProjects(projects);
      return 0;
    } catch (err) {
      return handlePlatformError(err);
    }
  }

  const file = await readCredentials();
  const ids = Object.keys(file.projects);

  banner('projects');
  blankLine();

  if (ids.length === 0) {
    step('no projects authenticated on this machine.');
    step('run: briven connect');
    step('then: briven projects create --name my-app');
    step('  or: briven projects use <p_...>');
    step('  or: briven login --project <p_...> --key <brk_...>');
    return 0;
  }

  step(`${ids.length} project${ids.length === 1 ? '' : 's'} authenticated:`);
  for (const id of ids.sort()) {
    const cred = file.projects[id]!;
    const isDefault = file.default === id;
    const marker = isDefault ? '*' : ' ';
    step(`  ${marker} ${id}  ·  ${cred.apiOrigin}  ·  key …${cred.suffix}`);
  }
  if (file.default) {
    blankLine();
    step(`default: ${file.default}`);
  }
  blankLine();
  step('account projects: briven projects list --remote');
  return 0;
}

async function createProject(argv: readonly string[]): Promise<number> {
  const name = flagValue(argv, '--name') ?? flagValue(argv, '-n');
  const region = flagValue(argv, '--region') ?? REGIONS[0]!.id;
  const slug = flagValue(argv, '--slug');
  const noUse = hasFlag(argv, '--no-use');

  if (!name) {
    printError('usage: briven projects create --name <name> [--region eu-west]');
    return 1;
  }

  if (!REGIONS.some((r) => r.id === region)) {
    printError(`unknown region: ${region}`);
    step(`known: ${REGIONS.map((r) => r.id).join(', ')}`);
    return 1;
  }

  banner('projects create');
  blankLine();

  try {
    const user = await ensurePlatformSession({ quiet: true });
    step(`creating "${name}" in ${region}…`);
    const project = await createRemoteProject(user.apiOrigin, user.token, {
      name,
      region,
      slug,
    });
    success(`created ${project.slug} (${project.id})`);

    if (!noUse) {
      step('minting cli credentials…');
      const { suffix } = await mintAndStoreKey(user.apiOrigin, user.token, project.id);
      await setDefaultId(project.id);
      success(`cli key stored (····${suffix}) · default set`);
    }

    const origins = resolveOrigins();
    step(`dashboard: ${origins.dashboardOrigin}/dashboard/projects/${project.id}`);
    blankLine();
    step('next: briven init   then   briven link --project ' + project.id);
    step('  or: briven projects use ' + project.id + ' --link');
    return 0;
  } catch (err) {
    return handlePlatformError(err);
  }
}

async function useProject(argv: readonly string[]): Promise<number> {
  const projectId = argv.find((a) => !a.startsWith('-'));
  const doLink = hasFlag(argv, '--link');

  if (!projectId) {
    printError('usage: briven projects use <projectId> [--link]');
    return 1;
  }

  banner(`projects use ${projectId}`);
  blankLine();

  try {
    const user = await ensurePlatformSession({ quiet: true });

    // Confirm the project is on the account before minting a key.
    const remote = await listRemoteProjects(user.apiOrigin, user.token);
    const match = remote.find((p) => p.id === projectId || p.slug === projectId);
    if (!match) {
      printError(`project not found on your account: ${projectId}`);
      step('run: briven projects list --remote');
      return 1;
    }

    const id = match.id;
    step(`minting cli credentials for ${match.slug}…`);
    const { suffix } = await mintAndStoreKey(user.apiOrigin, user.token, id);
    await setDefaultId(id);
    success(`using ${match.slug} (${id}) · key ····${suffix}`);

    if (doLink) {
      const linked = await linkCwd(id, match.slug);
      if (linked === 'ok') {
        success(`linked briven.json → ${id}`);
      } else if (linked === 'no-config') {
        step('no briven.json here — run: briven init && briven link');
      }
    } else {
      step('bind this folder: briven link --project ' + id);
      step('             or: briven projects use ' + id + ' --link');
    }
    return 0;
  } catch (err) {
    return handlePlatformError(err);
  }
}

async function unlinkProject(targetId: string): Promise<number> {
  const file = await readCredentials();
  if (!file.projects[targetId]) {
    printError(`no local credentials for ${targetId}`);
    return 1;
  }
  delete file.projects[targetId];
  if (file.default === targetId) delete file.default;
  await writeCredentials(file);
  success(`unlinked local credentials for ${targetId}`);
  step('project still exists on the platform — this only forgets the key on this machine.');
  return 0;
}

async function setDefault(targetId: string): Promise<number> {
  const file = await readCredentials();
  if (!file.projects[targetId]) {
    printError(`no credentials stored for ${targetId}`);
    step(`run: briven projects use ${targetId}`);
    step(`  or: briven login --project ${targetId} --key <brk_...>`);
    return 1;
  }
  await setDefaultId(targetId);
  success(`default project set to ${targetId}`);
  return 0;
}

async function setDefaultId(projectId: string): Promise<void> {
  const file = await readCredentials();
  const next: CredentialsFile = { ...file, default: projectId };
  await writeCredentials(next);
}

async function linkCwd(
  projectId: string,
  slug: string,
): Promise<'ok' | 'no-config'> {
  const local = await readProjectConfig();
  if (!local) return 'no-config';
  await writeProjectConfig({
    ...local,
    name: local.name || slug || basename(process.cwd()),
    projectId,
  });
  return 'ok';
}

function handlePlatformError(err: unknown): number {
  if (err instanceof ApiCallError) {
    if (err.status === 401 || err.status === 403) {
      printSessionExpiredHint();
      return 1;
    }
    printError(`${err.code}: ${err.message}`);
    return 1;
  }
  printError(err instanceof Error ? err.message : 'unknown error');
  return 1;
}

