import { basename } from 'node:path';
import { createInterface } from 'node:readline';

import { apiCall } from './api-client.js';
import { writeProjectConfig } from './project-config.js';
import { readUserCredential, writeUserCredential } from './config.js';
import { runOAuth } from './oauth.js';
import { runInit } from './commands/init.js';
import { REGIONS } from './regions.js';
import { pullSchemaToDisk } from './schema-pull.js';
import { banner, blankLine, error as printError, step, success } from './output.js';

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
  success(`linked ${project.slug} (${project.id})`);
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
