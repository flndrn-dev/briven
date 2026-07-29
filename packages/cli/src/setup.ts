/**
 * Product CLI paths (split like Convex’s “new vs existing”):
 *
 *   briven setup    → create a **new** cloud project + wire this folder + S3
 *   briven connect  → attach an **existing** project + wire this folder + S3
 *
 * Templates are optional starters, not the product model.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';

import { ApiCallError } from './api-client.js';
import { generate, type SchemaSnapshot } from './codegen.js';
import { enableAuthForProject } from './commands/auth.js';
import { runInit } from './commands/init.js';
import { runStorage } from './commands/storage.js';
import { mergeEnvFile } from './env-file.js';
import { resolveOrigins, type Origins } from './origins.js';
import {
  createRemoteProject,
  ensurePlatformSession,
  fetchMe,
  listRemoteProjects,
  mintAndStoreKey,
  type ProjectStorageBootstrap,
  type RemoteProject,
} from './platform.js';
import { readProjectConfig, writeProjectConfig } from './project-config.js';
import { REGIONS } from './regions.js';
import { pullSchemaToDisk } from './schema-pull.js';
import {
  banner,
  blankLine,
  error as printError,
  link as printLink,
  step,
  success,
} from './output.js';

const TEMPLATES = ['blank', 'todo-app', 'chat', 'convex-notes', 'supabase-auth-todos'] as const;
export type SetupTemplate = (typeof TEMPLATES)[number];

export interface SetupArgs {
  name?: string;
  /** @deprecated on setup — use `briven connect --project`. Still parsed so we can redirect. */
  project?: string;
  region: string;
  template: SetupTemplate;
  yes: boolean;
  cwd: string;
  origins: Origins;
}

/** Args shared by attach-existing (`briven connect`). */
export interface ConnectProjectArgs {
  project?: string;
  template: SetupTemplate;
  yes: boolean;
  force: boolean;
  cwd: string;
  origins: Origins;
}

export type Branch = 'wizard' | 'auth-then-watch' | 'watch';

export function decideBranch(state: { hasBrivenJson: boolean; hasUserToken: boolean }): Branch {
  if (!state.hasBrivenJson) return 'wizard';
  if (!state.hasUserToken) return 'auth-then-watch';
  return 'watch';
}

export function parseSetupArgs(argv: readonly string[]): SetupArgs {
  const out: SetupArgs = {
    region: REGIONS[0]!.id,
    template: 'blank',
    yes: false,
    cwd: process.cwd(),
    origins: resolveOrigins(),
  };

  // Bare arg: `briven setup my-app` → new project name only.
  // `p_…` is NOT accepted here — use `briven connect`.
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--name' || arg === '-n') && argv[i + 1]) {
      out.name = argv[++i];
    } else if (arg?.startsWith('--name=')) {
      out.name = arg.slice('--name='.length);
    } else if ((arg === '--project' || arg === '-p') && argv[i + 1]) {
      out.project = argv[++i];
    } else if (arg?.startsWith('--project=')) {
      out.project = arg.slice('--project='.length);
    } else if (arg === '--region' && argv[i + 1]) {
      out.region = argv[++i]!;
    } else if (arg?.startsWith('--region=')) {
      out.region = arg.slice('--region='.length);
    } else if ((arg === '--template' || arg === '-t') && argv[i + 1]) {
      out.template = argv[++i] as SetupTemplate;
    } else if (arg?.startsWith('--template=')) {
      out.template = arg.slice('--template='.length) as SetupTemplate;
    } else if (arg === '--yes' || arg === '-y') {
      out.yes = true;
    } else if (arg === '--api-origin' && argv[i + 1]) {
      out.origins = resolveOrigins({
        apiOrigin: argv[++i],
        dashboardOrigin: out.origins.dashboardOrigin,
      });
    } else if (arg === '--dashboard-origin' && argv[i + 1]) {
      out.origins = resolveOrigins({
        apiOrigin: out.origins.apiOrigin,
        dashboardOrigin: argv[++i],
      });
    } else if (arg && !arg.startsWith('-')) {
      positionals.push(arg);
    }
  }

  if (positionals.length > 0 && !out.name) {
    out.name = positionals[0];
  }

  return out;
}

/** Project ids (`p_…`) — use with `briven connect`, not setup. */
export function looksLikeProjectRef(value: string): boolean {
  return /^p_[A-Za-z0-9]+$/u.test(value);
}

export function parseConnectProjectArgs(argv: readonly string[]): ConnectProjectArgs {
  const out: ConnectProjectArgs = {
    template: 'blank',
    yes: false,
    force: false,
    cwd: process.cwd(),
    origins: resolveOrigins(),
  };
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--project' || arg === '-p') && argv[i + 1]) {
      out.project = argv[++i];
    } else if (arg?.startsWith('--project=')) {
      out.project = arg.slice('--project='.length);
    } else if ((arg === '--template' || arg === '-t') && argv[i + 1]) {
      out.template = argv[++i] as SetupTemplate;
    } else if (arg?.startsWith('--template=')) {
      out.template = arg.slice('--template='.length) as SetupTemplate;
    } else if (arg === '--yes' || arg === '-y') {
      out.yes = true;
    } else if (arg === '--force' || arg === '-f') {
      out.force = true;
    } else if (arg === '--api-origin' && argv[i + 1]) {
      out.origins = resolveOrigins({
        apiOrigin: argv[++i],
        dashboardOrigin: out.origins.dashboardOrigin,
      });
    } else if (arg === '--dashboard-origin' && argv[i + 1]) {
      out.origins = resolveOrigins({
        apiOrigin: out.origins.apiOrigin,
        dashboardOrigin: argv[++i],
      });
    } else if (arg && !arg.startsWith('-')) {
      positionals.push(arg);
    }
  }

  if (positionals.length > 0 && !out.project) {
    out.project = positionals[0];
  }

  return out;
}

export function printSetupHelp(): void {
  banner('setup');
  blankLine();
  step('create a **new** cloud project + S3 bucket/key + wire this folder');
  blankLine();
  step('usage:');
  step('  briven setup                         interactive (recommended)');
  step('  briven setup my-app                  create a new project named my-app');
  step('  briven setup --name my-app           same as above');
  step('  briven setup --name app --template todo-app --region eu-west');
  blankLine();
  step('always includes:');
  step('  · platform sign-in');
  step('  · brand-new cloud project');
  step('  · private S3 bucket + storage key → .env.local');
  step('  · local scaffold + CLI project key');
  blankLine();
  step('options:');
  step('  --name, -n <name>        create a new cloud project with this name');
  step('  --region <id>            region (default: eu-west)');
  step('  --template, -t <name>    blank | todo-app | chat | convex-notes | …');
  step('  --yes, -y                defaults for remaining prompts (folder name, etc.)');
  blankLine();
  step('existing project? use:');
  step('  briven connect                       pick an existing project');
  step('  briven connect p_01HZ...             attach that project');
  blankLine();
  step('after setup:');
  step('  briven deploy   |   briven dev');
  printLink('https://docs.briven.tech/connect');
}

export function printConnectProjectHelp(): void {
  banner('connect');
  blankLine();
  step('attach an **existing** cloud project + S3 key + wire this folder');
  blankLine();
  step('usage:');
  step('  briven connect                       sign in + pick a project (recommended)');
  step('  briven connect p_01HZ...             attach this project id');
  step('  briven connect --project p_01HZ...   same as above');
  step('  briven connect my-slug               attach by project slug');
  blankLine();
  step('also:');
  step('  briven connect status                show platform session + local keys');
  step('  briven connect logout                forget platform session (keep project keys)');
  blankLine();
  step('options:');
  step('  --project, -p <id|slug>  existing project on your account');
  step('  --template, -t <name>    scaffold template if folder has no briven/ yet');
  step('  --yes, -y                non-interactive when possible (first project if only one)');
  step('  --force, -f              re-authorize in the browser before attaching');
  blankLine();
  step('brand-new project? use:');
  step('  briven setup my-app');
  blankLine();
  step('after connect:');
  step('  briven deploy   |   briven dev');
  printLink('https://docs.briven.tech/connect');
}

/**
 * Create a **new** project and wire this folder. Returns process exit code.
 */
export async function runSetup(argv: readonly string[] = []): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    printSetupHelp();
    return 0;
  }

  const args = parseSetupArgs(argv);

  // Redirect: attach existing belongs to `briven connect`.
  if (args.project) {
    printError('setup creates a new project only');
    step(`to attach an existing project:  briven connect ${args.project}`);
    step('or:  briven connect --project ' + args.project);
    return 1;
  }
  if (args.name && looksLikeProjectRef(args.name)) {
    printError(`"${args.name}" looks like an existing project id`);
    step(`to attach it:  briven connect ${args.name}`);
    step('to create a new project with a normal name:  briven setup my-app');
    return 1;
  }

  if (!TEMPLATES.includes(args.template)) {
    printError(`unknown template: ${args.template}`);
    step(`known: ${TEMPLATES.join(', ')}`);
    return 1;
  }

  if (!REGIONS.some((r) => r.id === args.region)) {
    printError(`unknown region: ${args.region}`);
    step(`known: ${REGIONS.map((r) => r.id).join(', ')}`);
    return 1;
  }

  banner('setup');
  blankLine();
  step('create a new briven cloud project and wire this folder');
  blankLine();

  try {
    step('signing in to the platform…');
    const user = await ensurePlatformSession({
      quiet: true,
      origins: args.origins,
    });
    const me = await fetchMe(user.apiOrigin, user.token);
    success(`signed in as ${me.email}`);
    blankLine();

    if (args.name) {
      return await createNew(args, user.token, args.name, args.region, args.template);
    }

    if (args.yes) {
      const name = basename(args.cwd);
      return await createNew(args, user.token, name, args.region, args.template);
    }

    return await interactiveNew(args, user.token);
  } catch (err) {
    if (err instanceof ApiCallError) {
      printError(`setup failed: ${err.code} (${err.status}) — ${err.message}`);
    } else {
      printError(err instanceof Error ? err.message : 'setup failed');
    }
    return 1;
  }
}

/**
 * Attach an **existing** project and wire this folder. Used by `briven connect`.
 */
export async function runConnectProject(argv: readonly string[] = []): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    printConnectProjectHelp();
    return 0;
  }

  const args = parseConnectProjectArgs(argv);

  if (!TEMPLATES.includes(args.template)) {
    printError(`unknown template: ${args.template}`);
    step(`known: ${TEMPLATES.join(', ')}`);
    return 1;
  }

  banner('connect');
  blankLine();
  step('attach an existing briven cloud project to this folder');
  blankLine();

  const setupLike: SetupArgs = {
    region: REGIONS[0]!.id,
    template: args.template,
    yes: args.yes,
    cwd: args.cwd,
    origins: args.origins,
  };

  try {
    step(args.force ? 're-authorizing in the browser…' : 'signing in to the platform…');
    const user = await ensurePlatformSession({
      force: args.force,
      quiet: true,
      origins: args.origins,
    });
    const me = await fetchMe(user.apiOrigin, user.token);
    success(`signed in as ${me.email}`);
    blankLine();

    if (args.project) {
      return await attachExisting(setupLike, user.token, args.project);
    }

    return await interactiveExisting(setupLike, user.token, args.yes);
  } catch (err) {
    if (err instanceof ApiCallError) {
      printError(`connect failed: ${err.code} (${err.status}) — ${err.message}`);
    } else {
      printError(err instanceof Error ? err.message : 'connect failed');
    }
    return 1;
  }
}

/**
 * Used by `briven dev` when the folder is not yet wired.
 * Same flow as `briven setup`, with origins from the env.
 */
export async function runWizard(env: {
  apiOrigin: string;
  dashboardOrigin: string;
  cwd?: string;
}): Promise<void> {
  const prevApi = process.env.BRIVEN_API_ORIGIN;
  const prevDash = process.env.BRIVEN_DASHBOARD_ORIGIN;
  process.env.BRIVEN_API_ORIGIN = env.apiOrigin;
  process.env.BRIVEN_DASHBOARD_ORIGIN = env.dashboardOrigin;
  const prevCwd = process.cwd();
  try {
    if (env.cwd && env.cwd !== prevCwd) {
      process.chdir(env.cwd);
    }
    await runSetup([]);
  } finally {
    if (env.cwd && env.cwd !== prevCwd) {
      process.chdir(prevCwd);
    }
    if (prevApi === undefined) delete process.env.BRIVEN_API_ORIGIN;
    else process.env.BRIVEN_API_ORIGIN = prevApi;
    if (prevDash === undefined) delete process.env.BRIVEN_DASHBOARD_ORIGIN;
    else process.env.BRIVEN_DASHBOARD_ORIGIN = prevDash;
  }
}

async function interactiveNew(args: SetupArgs, token: string): Promise<number> {
  const defaultName = basename(args.cwd);
  const name = (await promptLine(`project name [${defaultName}]: `)).trim() || defaultName;

  step('pick region:');
  REGIONS.forEach((r, i) => step(`  ${i + 1}. ${r.id}  — ${r.label}`));
  const regionPick = await promptLine('region [1]: ');
  const regionIdx = Math.max(1, Number.parseInt(regionPick || '1', 10)) - 1;
  const region = REGIONS[regionIdx]?.id ?? REGIONS[0]!.id;

  step('pick template (optional starter — not required to use briven):');
  TEMPLATES.forEach((t, i) => step(`  ${i + 1}. ${t}`));
  const tPick = await promptLine('template [1]: ');
  const tIdx = Math.max(1, Number.parseInt(tPick || '1', 10)) - 1;
  const template = TEMPLATES[tIdx] ?? 'blank';

  return createNew(args, token, name, region, template);
}

async function interactiveExisting(
  args: SetupArgs,
  token: string,
  yes = false,
): Promise<number> {
  const projects = await listRemoteProjects(args.origins.apiOrigin, token);
  if (projects.length === 0) {
    printError('no projects on your account yet');
    step('create one first:  briven setup my-app');
    return 1;
  }
  if (yes && projects.length === 1) {
    return finishExisting(args, token, projects[0]!);
  }
  if (yes && projects.length > 1) {
    printError('several projects on your account — pass which one:');
    step('  briven connect p_…');
    step('  briven connect --project <slug>');
    projects.forEach((p) => step(`  · ${p.slug}  (${p.id})`));
    return 1;
  }
  step('your projects:');
  projects.forEach((p, i) =>
    step(`  ${i + 1}. ${p.orgName ?? '—'}/${p.slug}  (${p.id}) · ${p.region} · ${p.tier}`),
  );
  const pick = await promptLine(`pick [1-${projects.length}]: `);
  const idx = Number.parseInt(pick.trim(), 10) - 1;
  const project = projects[idx];
  if (!project) {
    printError('invalid selection');
    return 1;
  }
  return finishExisting(args, token, project);
}

async function attachExisting(
  args: SetupArgs,
  token: string,
  idOrSlug: string,
): Promise<number> {
  const projects = await listRemoteProjects(args.origins.apiOrigin, token);
  const match = projects.find((p) => p.id === idOrSlug || p.slug === idOrSlug);
  if (!match) {
    printError(`project not found on your account: ${idOrSlug}`);
    step('run: briven projects list --remote');
    return 1;
  }
  return finishExisting(args, token, match);
}

async function createNew(
  args: SetupArgs,
  token: string,
  name: string,
  region: string,
  template: SetupTemplate,
): Promise<number> {
  step(`creating project "${name}" in ${region}…`);
  const created = await createRemoteProject(args.origins.apiOrigin, token, { name, region });
  success(`created ${created.slug} (${created.id})`);

  step(`scaffolding template: ${template}`);
  await runInit(['--name', name, '--template', template, '--force']);
  await writeProjectConfig({ name, projectId: created.id, region }, args.cwd);

  step('minting cli credentials…');
  await mintAndStoreKey(args.origins.apiOrigin, token, created.id);

  await writeGeneratedFiles({
    cwd: args.cwd,
    snapshot: { version: 1, tables: {} },
    functionFilenames: await listFunctionFilenames(args.cwd),
  });
  await writeEnvLocal({
    cwd: args.cwd,
    projectId: created.id,
    apiOrigin: args.origins.apiOrigin,
    storage: created.storage,
  });

  // Storage is required for a complete setup — not an optional extra step.
  if (created.storage) {
    success('S3 bucket + default storage key ready (saved in .env.local)');
    step(`bucket  ${created.storage.bucket}`);
  } else {
    const st = await ensureStorageInSetup(created.id);
    if (st !== 0) return st;
  }

  // Auth on by default for new CLI projects (Clerk-simple path).
  await enableAuthInSetup({
    cwd: args.cwd,
    apiOrigin: args.origins.apiOrigin,
    token,
    projectId: created.id,
  });

  blankLine();
  success('folder fully wired (project + CLI key + S3 + Auth)');
  printDone(args, created.id, created.slug);
  return 0;
}

async function finishExisting(
  args: SetupArgs,
  token: string,
  project: RemoteProject,
): Promise<number> {
  step(`attaching ${project.slug} (${project.id})…`);

  // Ensure local scaffold exists so deploy/dev have a place to work.
  const local = await readProjectConfig(args.cwd);
  if (!local) {
    step(`scaffolding template: ${args.template}`);
    await runInit(['--name', project.slug, '--template', args.template, '--force']);
  }

  try {
    await pullSchemaToDisk({
      apiOrigin: args.origins.apiOrigin,
      bearer: token,
      projectId: project.id,
      cwd: args.cwd,
    });
  } catch (err) {
    // Empty / brand-new projects may not export a schema yet — not fatal.
    step(
      `schema pull skipped: ${err instanceof Error ? err.message : 'unavailable'}`,
    );
  }

  await writeProjectConfig(
    {
      name: local?.name || project.slug,
      projectId: project.id,
      region: project.region,
    },
    args.cwd,
  );

  step('minting cli credentials…');
  await mintAndStoreKey(args.origins.apiOrigin, token, project.id);

  await writeGeneratedFiles({
    cwd: args.cwd,
    snapshot: { version: 1, tables: {} },
    functionFilenames: await listFunctionFilenames(args.cwd),
  });
  await writeEnvLocal({
    cwd: args.cwd,
    projectId: project.id,
    apiOrigin: args.origins.apiOrigin,
  });

  // Required: attach always gets a fresh key + .env.local storage block.
  const st = await ensureStorageInSetup(project.id);
  if (st !== 0) return st;

  // Ensure Auth is on when attaching (idempotent if already enabled).
  await enableAuthInSetup({
    cwd: args.cwd,
    apiOrigin: args.origins.apiOrigin,
    token,
    projectId: project.id,
  });

  blankLine();
  success(`folder fully wired to ${project.slug} (project + CLI key + S3 + Auth)`);
  printDone(args, project.id, project.slug);
  return 0;
}

/** Bucket + key + write env. Returns 0 on success; setup must abort on non-zero. */
async function ensureStorageInSetup(projectId: string): Promise<number> {
  step('ensuring S3 bucket + storage key (required)…');
  try {
    const code = await runStorage([
      'setup',
      '--name',
      'default',
      '--write-env',
      '--project',
      projectId,
    ]);
    if (code !== 0) {
      printError(
        'storage setup failed — briven setup is incomplete without an S3 bucket/key.',
      );
      step('platform: check MinIO (BRIVEN_MINIO_*) on the API host.');
      step('or retry: briven storage setup --write-env');
      return 1;
    }
    return 0;
  } catch (err) {
    printError(err instanceof Error ? err.message : 'storage setup failed');
    return 1;
  }
}

/**
 * Turn Briven Auth on as part of setup/connect (idempotent).
 * Writes pk_briven_auth_… into .env.local when a new key is minted.
 * Non-fatal: setup still succeeds if Auth enable fails (network / permissions).
 */
async function enableAuthInSetup(args: {
  cwd: string;
  apiOrigin: string;
  token: string;
  projectId: string;
}): Promise<void> {
  step('enabling Briven Auth (starter pack + browser key)…');
  const result = await enableAuthForProject({
    projectId: args.projectId,
    apiOrigin: args.apiOrigin,
    bearer: args.token,
    quiet: true,
    cwd: args.cwd,
  });
  if (!result.ok) {
    step(`auth enable skipped: ${result.message}`);
    step('later: briven auth enable');
    return;
  }
  for (const action of result.actions) {
    step(`  · ${action}`);
  }
  if (result.publicKey) {
    success('Auth on · browser public key saved to .env.local');
  } else {
    success('Auth on · browser public key already present');
  }
}

function printDone(args: SetupArgs, projectId: string, slug: string): void {
  step(`project   ${slug} (${projectId})`);
  step(`dashboard ${args.origins.dashboardOrigin}/dashboard/projects/${projectId}`);
  step('storage   S3 bucket + key in .env.local (BRIVEN_STORAGE_* / AWS_*)');
  step('auth      enabled (or run: briven auth enable)');
  blankLine();
  step('next:');
  step('  briven auth scaffold   optional app middleware + sign-in files');
  step('  briven deploy          push schema + functions once');
  step('  briven dev             watch mode (push on save)');
  printLink('https://docs.briven.tech/connect');
}

async function writeEnvLocal(args: {
  cwd: string;
  projectId: string;
  apiOrigin: string;
  storage?: ProjectStorageBootstrap | null;
}): Promise<void> {
  const path = join(args.cwd, '.env.local');
  let existing = '';
  try {
    existing = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    existing = '';
  }
  const vars: Record<string, string> = {
    BRIVEN_DEPLOYMENT: args.projectId,
    NEXT_PUBLIC_BRIVEN_URL: args.apiOrigin,
  };
  if (args.storage) {
    vars.BRIVEN_STORAGE_ENDPOINT = args.storage.endpoint;
    vars.BRIVEN_STORAGE_BUCKET = args.storage.bucket;
    vars.BRIVEN_STORAGE_ACCESS_KEY = args.storage.accessKey;
    vars.BRIVEN_STORAGE_SECRET_KEY = args.storage.secretKey;
    vars.AWS_ENDPOINT_URL = args.storage.endpoint;
    vars.AWS_ACCESS_KEY_ID = args.storage.accessKey;
    vars.AWS_SECRET_ACCESS_KEY = args.storage.secretKey;
    vars.S3_BUCKET = args.storage.bucket;
  }
  const merged = mergeEnvFile(existing, vars);
  await writeFile(path, merged, 'utf8');
}

async function writeGeneratedFiles(args: {
  cwd: string;
  snapshot: SchemaSnapshot;
  functionFilenames: string[];
}): Promise<void> {
  const files = generate(args.snapshot, args.functionFilenames);
  for (const [relPath, content] of files) {
    const abs = join(args.cwd, relPath);
    await mkdir(join(abs, '..'), { recursive: true });
    let existing: string | null = null;
    try {
      existing = await readFile(abs, 'utf8');
    } catch {
      existing = null;
    }
    if (existing !== content) {
      await writeFile(abs, content, 'utf8');
    }
  }
}

async function listFunctionFilenames(cwd: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  try {
    const all = await readdir(join(cwd, 'briven', 'functions'));
    return all.filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  } catch {
    return [];
  }
}

function promptLine(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.once('line', (line) => {
      rl.close();
      resolve(line);
    });
  });
}
