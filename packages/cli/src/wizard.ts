import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';

import { generate, type SchemaSnapshot } from './codegen.js';
import { writeProjectConfig } from './project-config.js';
import { mergeEnvFile } from './env-file.js';
import { runInit } from './commands/init.js';
import {
  createRemoteProject,
  ensurePlatformSession,
  fetchMe,
  listRemoteProjects,
  mintAndStoreKey,
} from './platform.js';
import { REGIONS } from './regions.js';
import { pullSchemaToDisk } from './schema-pull.js';
import { banner, blankLine, error as printError, step, success } from './output.js';

async function writeEnvLocal(args: {
  cwd: string;
  projectId: string;
  apiOrigin: string;
}): Promise<void> {
  const path = join(args.cwd, '.env.local');
  let existing = '';
  try {
    existing = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    existing = '';
  }
  const merged = mergeEnvFile(existing, {
    BRIVEN_DEPLOYMENT: args.projectId,
    NEXT_PUBLIC_BRIVEN_URL: args.apiOrigin,
  });
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

export type Branch = 'wizard' | 'auth-then-watch' | 'watch';

export function decideBranch(state: { hasBrivenJson: boolean; hasUserToken: boolean }): Branch {
  if (!state.hasBrivenJson) return 'wizard';
  if (!state.hasUserToken) return 'auth-then-watch';
  return 'watch';
}

export interface WizardEnv {
  apiOrigin: string;
  dashboardOrigin: string;
  cwd?: string;
}

export async function runWizard(env: WizardEnv): Promise<void> {
  const cwd = env.cwd ?? process.cwd();
  banner('briven setup');
  blankLine();

  step('checking platform session…');
  const user = await ensurePlatformSession({
    quiet: true,
    origins: { apiOrigin: env.apiOrigin, dashboardOrigin: env.dashboardOrigin },
  });
  try {
    const me = await fetchMe(user.apiOrigin, user.token);
    success(`signed in as ${me.email}`);
  } catch {
    success('platform session ready');
  }
  blankLine();

  const choice = await promptLine('(N)ew project or (E)xisting? [N/e] ');
  if (choice.trim().toLowerCase().startsWith('e')) {
    await existingBranch(env, user.token, cwd);
  } else {
    await newBranch(env, user.token, cwd);
  }
}

async function newBranch(env: WizardEnv, token: string, cwd: string): Promise<void> {
  const defaultName = basename(cwd);
  const name = (await promptLine(`project name [${defaultName}]: `)).trim() || defaultName;

  step('pick region:');
  REGIONS.forEach((r, i) => step(`  ${i + 1}. ${r.id}  — ${r.label}`));
  const regionPick = await promptLine('region [1]: ');
  const regionIdx = Math.max(1, Number.parseInt(regionPick || '1', 10)) - 1;
  const region = REGIONS[regionIdx]?.id ?? REGIONS[0]!.id;

  const created = await createRemoteProject(env.apiOrigin, token, { name, region });

  step('pick template:');
  const tpls = ['blank', 'todo-app', 'chat', 'convex-notes', 'supabase-auth-todos'] as const;
  tpls.forEach((t, i) => step(`  ${i + 1}. ${t}`));
  const tPick = await promptLine('template [1]: ');
  const tIdx = Math.max(1, Number.parseInt(tPick || '1', 10)) - 1;
  const template = tpls[tIdx] ?? 'blank';

  await runInit(['--name', name, '--template', template, '--force']);
  await writeProjectConfig({ name, projectId: created.id }, cwd);
  step('minting cli credentials…');
  await mintAndStoreKey(env.apiOrigin, token, created.id);
  await writeGeneratedFiles({
    cwd,
    snapshot: { version: 1, tables: {} },
    functionFilenames: await listFunctionFilenames(cwd),
  });
  await writeEnvLocal({ cwd, projectId: created.id, apiOrigin: env.apiOrigin });
  success(`created ${created.slug} (${created.id})`);
  step(`dashboard: ${env.dashboardOrigin}/dashboard/projects/${created.id}`);
}

async function existingBranch(env: WizardEnv, token: string, cwd: string): Promise<void> {
  const projects = await listRemoteProjects(env.apiOrigin, token);

  if (projects.length === 0) {
    printError('no projects on your account yet — re-run and pick (N)ew.');
    return;
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
    return;
  }

  await pullSchemaToDisk({
    apiOrigin: env.apiOrigin,
    bearer: token,
    projectId: project.id,
    cwd,
  });
  await writeProjectConfig({ name: project.slug, projectId: project.id }, cwd);
  step('minting cli credentials…');
  await mintAndStoreKey(env.apiOrigin, token, project.id);
  await writeGeneratedFiles({
    cwd,
    snapshot: { version: 1, tables: {} },
    functionFilenames: await listFunctionFilenames(cwd),
  });
  await writeEnvLocal({ cwd, projectId: project.id, apiOrigin: env.apiOrigin });
  success(`linked ${project.slug} (${project.id})`);
  step(`dashboard: ${env.dashboardOrigin}/dashboard/projects/${project.id}`);
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
