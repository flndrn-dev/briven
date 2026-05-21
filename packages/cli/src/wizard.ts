import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';

import { apiCall } from './api-client.js';
import { generate, type SchemaSnapshot } from './codegen.js';
import { writeProjectConfig } from './project-config.js';
import { readUserCredential, writeProjectCredential, writeUserCredential } from './config.js';
import { runOAuth } from './oauth.js';
import { runInit } from './commands/init.js';
import { REGIONS } from './regions.js';
import { pullSchemaToDisk } from './schema-pull.js';
import { banner, blankLine, error as printError, step, success } from './output.js';

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

  let user = await readUserCredential();
  if (!user) {
    step('opening browser to authorize the cli…');
    const { token } = await runOAuth({
      apiOrigin: env.apiOrigin,
      dashboardOrigin: env.dashboardOrigin,
    });
    const me = await apiCall<{ user: { id: string; email: string } }>('/v1/me', {
      apiOrigin: env.apiOrigin,
      bearer: token,
    });
    user = {
      token,
      userId: me.user.id,
      apiOrigin: env.apiOrigin,
      savedAt: new Date().toISOString(),
    };
    await writeUserCredential(user);
    success(`signed in as ${me.user.email}`);
    blankLine();
  }

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

  const created = await apiCall<{ project: { id: string; slug: string } }>('/v1/projects', {
    apiOrigin: env.apiOrigin,
    bearer: token,
    method: 'POST',
    body: { name, region, tier: 'free' },
  });

  step('pick template:');
  const tpls = ['blank', 'todo-app', 'chat', 'convex-notes', 'supabase-auth-todos'] as const;
  tpls.forEach((t, i) => step(`  ${i + 1}. ${t}`));
  const tPick = await promptLine('template [1]: ');
  const tIdx = Math.max(1, Number.parseInt(tPick || '1', 10)) - 1;
  const template = tpls[tIdx] ?? 'blank';

  await runInit(['--name', name, '--template', template, '--force']);
  await writeProjectConfig({ name, projectId: created.project.id }, cwd);
  await mintAndStoreKey(env, token, created.project.id);
  await writeGeneratedFiles({
    cwd,
    snapshot: { version: 1, tables: {} },
    functionFilenames: await listFunctionFilenames(cwd),
  });
  success(`created ${created.project.slug} (${created.project.id})`);
}

async function existingBranch(env: WizardEnv, token: string, cwd: string): Promise<void> {
  const list = await apiCall<{
    projects: Array<{ id: string; slug: string; region: string; tier: string; orgName: string }>;
  }>('/v1/me/projects', {
    apiOrigin: env.apiOrigin,
    bearer: token,
  });

  if (list.projects.length === 0) {
    printError('no projects on your account yet — re-run and pick (N)ew.');
    return;
  }
  step('your projects:');
  list.projects.forEach((p, i) =>
    step(`  ${i + 1}. ${p.orgName ?? '—'}/${p.slug}  (${p.id}) · ${p.region} · ${p.tier}`),
  );
  const pick = await promptLine(`pick [1-${list.projects.length}]: `);
  const idx = Number.parseInt(pick.trim(), 10) - 1;
  const project = list.projects[idx];
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
  await mintAndStoreKey(env, token, project.id);
  await writeGeneratedFiles({
    cwd,
    snapshot: { version: 1, tables: {} },
    functionFilenames: await listFunctionFilenames(cwd),
  });
  success(`linked ${project.slug} (${project.id})`);
}

/**
 * Mint a project-scoped admin key via the control-plane and persist it
 * to `~/.config/briven/credentials.json` so subsequent `briven dev`
 * invocations have credentials. The plaintext is returned once by the
 * API and never logged.
 */
async function mintAndStoreKey(env: WizardEnv, token: string, projectId: string): Promise<void> {
  step('minting cli credentials…');
  const minted = await apiCall<{
    key: { id: string; suffix: string; createdAt: string };
    plaintext: string;
  }>(`/v1/projects/${projectId}/api-keys`, {
    apiOrigin: env.apiOrigin,
    bearer: token,
    method: 'POST',
    body: { name: 'cli', role: 'admin' },
  });
  await writeProjectCredential({
    projectId,
    apiKey: minted.plaintext,
    apiOrigin: env.apiOrigin,
    suffix: minted.key.suffix,
    createdAt: minted.key.createdAt,
  });
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
