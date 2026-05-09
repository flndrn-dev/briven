import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { readProjectConfig, writeProjectConfig } from '../project-config.js';
import { banner, blankLine, error as printError, link, step, success } from '../output.js';

interface Args {
  name?: string;
  force: boolean;
}

function parse(argv: readonly string[]): Args {
  const out: Args = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name' && argv[i + 1]) out.name = argv[++i];
    else if (a === '--force') out.force = true;
    else if (!a?.startsWith('-') && !out.name) out.name = a;
  }
  return out;
}

const SCHEMA_TEMPLATE = `/**
 * briven schema. Edit this file to add tables; the CLI diffs against the
 * currently deployed schema and generates the migration when you run
 * \`briven deploy\`.
 */
import { schema, table, text, timestamp } from '@briven/cli/schema';

export default schema({
  notes: table({
    id: text().primaryKey(),
    body: text().notNull(),
    createdAt: timestamp().default('now()').notNull(),
  }),
});
`;

const FUNCTION_TEMPLATE = `/**
 * Example query. Inside a briven project every file under \`briven/functions/\`
 * becomes a named, typed endpoint; this one resolves as \`listNotes\`.
 */
import { query, type Ctx } from '@briven/cli/server';

export default query(async (ctx: Ctx): Promise<Array<{ id: string; body: string }>> => {
  return ctx.db('notes').select(['id', 'body']).orderBy('createdAt', 'desc').limit(50);
});
`;

const GITIGNORE_ENTRIES = ['.briven/', 'node_modules/', 'dist/'];

export async function runInit(argv: readonly string[]): Promise<number> {
  const args = parse(argv);
  const cwd = process.cwd();
  const existing = await readProjectConfig(cwd);
  if (existing && !args.force) {
    printError('briven.json already exists — pass --force to overwrite.');
    return 1;
  }

  const name = args.name ?? basename(cwd);

  banner('init');
  step(`creating briven project '${name}'`);

  await writeProjectConfig({ name }, cwd);
  await mkdir(resolve(cwd, 'briven', 'functions'), { recursive: true });
  await writeFile(resolve(cwd, 'briven', 'schema.ts'), SCHEMA_TEMPLATE);
  await writeFile(resolve(cwd, 'briven', 'functions', 'notes.ts'), FUNCTION_TEMPLATE);
  await updateGitignore(cwd);

  success('scaffolded:');
  step('  briven.json');
  step('  briven/schema.ts');
  step('  briven/functions/notes.ts');
  blankLine();
  step('next: create a project in the dashboard, then run');
  step('      briven login --project <id> --key <brk_...>');
  step('      briven link');
  link('https://docs.briven.cloud/cli');
  return 0;
}

async function updateGitignore(cwd: string): Promise<void> {
  const path = resolve(cwd, '.gitignore');
  let current = '';
  try {
    current = await readFile(path, 'utf8');
  } catch (err) {
    if (
      !(
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'ENOENT'
      )
    ) {
      throw err;
    }
  }
  const missing = GITIGNORE_ENTRIES.filter((line) => !current.split(/\r?\n/).includes(line));
  if (missing.length === 0) return;
  const block = `\n# briven\n${missing.join('\n')}\n`;
  await writeFile(path, current + block);
}
