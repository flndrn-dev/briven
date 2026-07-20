/**
 * Convex-style one-shot setup: sign in → new or existing project → wire this folder.
 *
 * This is the product path for "open a terminal and get a live Briven backend."
 * Templates are optional starters, not the product model.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';

import { ApiCallError } from './api-client.js';
import { generate, type SchemaSnapshot } from './codegen.js';
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
  project?: string;
  region: string;
  template: SetupTemplate;
  yes: boolean;
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

  // Bare args: `briven setup my-app` → name; `briven setup p_…` / known id → project.
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

  // Positional after flags: first bare token is project name or existing project id/slug.
  if (positionals.length > 0 && !out.name && !out.project) {
    const bare = positionals[0]!;
    if (looksLikeProjectRef(bare)) {
      out.project = bare;
    } else {
      out.name = bare;
    }
  }

  return out;
}

/** Project ids (`p_…`) or obvious refs — treat as --project, else --name. */
export function looksLikeProjectRef(value: string): boolean {
  return /^p_[A-Za-z0-9]+$/u.test(value);
}

export function printSetupHelp(): void {
  banner('setup');
  blankLine();
  step('one command: sign in → new or existing project → wire this folder');
  blankLine();
  step('usage:');
  step('  briven setup                         interactive (recommended)');
  step('  briven setup my-app                  create a new project named my-app');
  step('  briven setup --name my-app           same as above');
  step('  briven setup --project p_01HZ...     attach an existing project');
  step('  briven setup --name app --template todo-app --region eu-west');
  blankLine();
  step('options:');
  step('  --name, -n <name>        create a new cloud project with this name');
  step('  --project, -p <id|slug>  use an existing project on your account');
  step('  --region <id>            region for new projects (default: eu-west)');
  step('  --template, -t <name>    blank | todo-app | chat | convex-notes | …');
  step('  --yes, -y                defaults for remaining prompts (folder name, etc.)');
  blankLine();
  step('after setup:');
  step('  briven deploy   |   briven dev');
  printLink('https://docs.briven.tech/connect');
}

/**
 * Full Convex-style setup. Returns process exit code.
 */
export async function runSetup(argv: readonly string[] = []): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    printSetupHelp();
    return 0;
  }

  const args = parseSetupArgs(argv);

  if (args.project && args.name) {
    printError('pass either --name (new) or --project (existing), not both');
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
  step('connect this folder to a briven cloud project (new or existing)');
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

    if (args.project) {
      return await attachExisting(args, user.token, args.project);
    }
    if (args.name) {
      return await createNew(args, user.token, args.name, args.region, args.template);
    }

    if (args.yes) {
      const name = basename(args.cwd);
      return await createNew(args, user.token, name, args.region, args.template);
    }

    const choice = await promptLine('(N)ew project or (E)xisting? [N/e] ');
    if (choice.trim().toLowerCase().startsWith('e')) {
      return await interactiveExisting(args, user.token);
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

async function interactiveExisting(args: SetupArgs, token: string): Promise<number> {
  const projects = await listRemoteProjects(args.origins.apiOrigin, token);
  if (projects.length === 0) {
    printError('no projects on your account yet — pick (N)ew instead.');
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

  if (created.storage) {
    success('S3 bucket + default storage key ready (saved in .env.local)');
    step(`bucket  ${created.storage.bucket}`);
  } else {
    // Fallback if API didn't return storage (MinIO off / older API).
    await ensureStorageInSetup(created.id);
  }

  blankLine();
  success('folder wired to your new briven project');
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

  // If the project has no storage key yet, mint one (new or old projects).
  await ensureStorageInSetup(project.id);

  blankLine();
  success(`folder wired to existing project ${project.slug}`);
  printDone(args, project.id, project.slug);
  return 0;
}

/** Bucket + default key + write env — never fails setup if storage is off. */
async function ensureStorageInSetup(projectId: string): Promise<void> {
  try {
    step('ensuring S3 bucket + default storage key…');
    const code = await runStorage([
      'setup',
      '--name',
      'default',
      '--write-env',
      '--project',
      projectId,
    ]);
    if (code !== 0) {
      step('storage setup skipped or failed — run later: briven storage setup --write-env');
    }
  } catch {
    step('storage setup skipped — run later: briven storage setup --write-env');
  }
}

function printDone(args: SetupArgs, projectId: string, slug: string): void {
  step(`project   ${slug} (${projectId})`);
  step(`dashboard ${args.origins.dashboardOrigin}/dashboard/projects/${projectId}`);
  blankLine();
  step('next:');
  step('  briven deploy     push schema + functions once');
  step('  briven dev        watch mode (push on save)');
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
