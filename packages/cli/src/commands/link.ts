import { createInterface } from 'node:readline';

import { apiCall, ApiCallError } from '../api-client.js';
import { readCredentials } from '../config.js';
import { readProjectConfig, writeProjectConfig } from '../project-config.js';
import {
  banner,
  blankLine,
  error as printError,
  link as printLink,
  step,
  success,
} from '../output.js';

interface ParsedArgs {
  projectId?: string;
}

function parse(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project' && argv[i + 1]) {
      out.projectId = argv[++i];
    } else if (arg && arg.startsWith('--project=')) {
      out.projectId = arg.slice('--project='.length);
    }
  }
  return out;
}

export async function runLink(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }

  const args = parse(argv);
  const local = await readProjectConfig();
  if (!local) {
    printError('no briven.json in this directory.');
    step('run: briven init');
    return 1;
  }

  const creds = await readCredentials();
  const known = Object.values(creds.projects);

  if (known.length === 0) {
    printError('no logged-in projects.');
    step('run: briven login --project <p_...> --key <brk_...>');
    return 1;
  }

  let projectId: string;

  if (args.projectId) {
    if (!creds.projects[args.projectId]) {
      printError(`no credentials for ${args.projectId}.`);
      step(`run: briven login --project ${args.projectId} --key <brk_...>`);
      return 1;
    }
    projectId = args.projectId;
  } else if (known.length === 1) {
    projectId = known[0]!.projectId;
  } else {
    banner('link');
    blankLine();
    step('available projects:');
    known.forEach((p, i) => {
      step(`  ${i + 1}. ${p.projectId}  ····${p.suffix}`);
    });
    blankLine();
    const pick = await promptLine(`        · pick [1-${known.length}]: `);
    const idx = Number.parseInt(pick.trim(), 10) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= known.length) {
      printError('invalid selection');
      return 1;
    }
    projectId = known[idx]!.projectId;
  }

  const cred = creds.projects[projectId]!;
  banner(`link ${projectId}`);
  step(`verifying via ${cred.apiOrigin}`);

  try {
    await apiCall(`/v1/projects/${projectId}/info`, {
      apiOrigin: cred.apiOrigin,
      apiKey: cred.apiKey,
    });
  } catch (err) {
    if (err instanceof ApiCallError) {
      printError(`server rejected the credentials: ${err.code} (${err.status})`);
    } else {
      printError(err instanceof Error ? err.message : 'unknown error');
    }
    return 1;
  }

  await writeProjectConfig({ ...local, projectId });
  blankLine();
  success(`linked ${local.name} → ${projectId}`);
  step('next: briven deploy   |   briven dev');
  printLink('https://docs.briven.cloud/cli');
  return 0;
}

function printHelp(): void {
  banner('link');
  blankLine();
  step('briven link                       pick from logged-in projects');
  step('briven link --project p_abc123    link to a specific project');
  blankLine();
  step('writes the project id into briven.json. requires `briven login` first.');
}

async function promptLine(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise((resolvePromise) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.once('line', (line) => {
      rl.close();
      resolvePromise(line);
    });
  });
}
