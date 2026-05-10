import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import { readProjectConfig, writeProjectConfig } from '../project-config.js';
import { banner, blankLine, error as printError, link, step, success } from '../output.js';

interface Args {
  name?: string;
  template: TemplateName;
  force: boolean;
  list: boolean;
}

type TemplateName = 'blank' | 'todo-app' | 'chat';

interface Template {
  description: string;
  files: Record<string, string>;
}

/**
 * Templates ship inline so `briven init` works on a fresh machine with
 * no network. Adding a new template = adding an entry here. The
 * sources mirror what's at /examples/<name>/ in the repo so the doc
 * pages and the CLI can never drift apart.
 */
const TEMPLATES: Record<TemplateName, Template> = {
  blank: {
    description: 'one table (notes), one query — minimal scaffold for kicking the tyres',
    files: {
      'briven/schema.ts': `/**
 * briven schema. Edit this file to add tables; the CLI diffs against
 * the currently deployed schema and generates the migration when you
 * run \`briven deploy\`.
 */
import { schema, table, text, timestamp } from '@briven/cli/schema';

export default schema({
  notes: table({
    id: text().primaryKey(),
    body: text().notNull(),
    createdAt: timestamp().default('now()').notNull(),
  }),
});
`,
      'briven/functions/listNotes.ts': `/**
 * Reactive query — every file under \`briven/functions/\` becomes a
 * named, typed endpoint. This one resolves as \`listNotes\`.
 */
import { query, type Ctx } from '@briven/cli/server';

export default query(async (ctx: Ctx): Promise<Array<{ id: string; body: string }>> => {
  return ctx.db('notes').select(['id', 'body']).orderBy('createdAt', 'desc').limit(50);
});
`,
    },
  },

  'todo-app': {
    description: 'canonical hello-world: 1 table, 4 mutations, 1 reactive query',
    files: {
      'briven/schema.ts': `import { boolean, schema, table, text, timestamp } from '@briven/cli/schema';

export default schema({
  todos: table({
    id: text().primaryKey(),
    body: text().notNull(),
    done: boolean().default(false).notNull(),
    createdAt: timestamp().default('now()').notNull(),
    completedAt: timestamp().nullable(),
  }),
});
`,
      'briven/functions/listTodos.ts': `import { query, type Ctx } from '@briven/cli/server';

interface Args {
  filter?: 'open' | 'done' | 'all';
}

export default query(async (ctx: Ctx, args: Args = {}) => {
  let q = ctx.db('todos').select(['id', 'body', 'done', 'createdAt', 'completedAt']);
  if (args.filter === 'open') q = q.where({ done: false });
  if (args.filter === 'done') q = q.where({ done: true });
  return q.orderBy('createdAt', 'desc').limit(200);
});
`,
      'briven/functions/createTodo.ts': `import { brivenError, mutation, type Ctx } from '@briven/cli/server';
import { ulid } from '@briven/shared';

interface Args {
  body: string;
}

export default mutation(async (ctx: Ctx, args: Args) => {
  const body = args.body?.trim();
  if (!body) throw new brivenError('validation_failed', 'body is required', { status: 400 });
  if (body.length > 280)
    throw new brivenError('validation_failed', 'body too long (max 280 chars)', { status: 400 });

  const id = ulid('td');
  const [row] = await ctx.db('todos').insert({ id, body, done: false }).returning();
  return row;
});
`,
      'briven/functions/toggleTodo.ts': `import { brivenError, mutation, type Ctx } from '@briven/cli/server';

interface Args {
  id: string;
}

export default mutation(async (ctx: Ctx, args: Args) => {
  if (!args.id) throw new brivenError('validation_failed', 'id is required', { status: 400 });
  const [existing] = await ctx.db('todos').select(['id', 'done']).where({ id: args.id }).limit(1);
  if (!existing) throw new brivenError('not_found', \`no todo \${args.id}\`, { status: 404 });

  const next = !existing.done;
  await ctx
    .db('todos')
    .update({ done: next, completedAt: next ? new Date().toISOString() : null })
    .where({ id: args.id });

  return { id: args.id, done: next };
});
`,
      'briven/functions/deleteTodo.ts': `import { brivenError, mutation, type Ctx } from '@briven/cli/server';

interface Args {
  id: string;
}

export default mutation(async (ctx: Ctx, args: Args) => {
  if (!args.id) throw new brivenError('validation_failed', 'id is required', { status: 400 });
  const affected = await ctx.db('todos').delete().where({ id: args.id });
  if (affected === 0) throw new brivenError('not_found', \`no todo \${args.id}\`, { status: 404 });
  return { id: args.id, deleted: true };
});
`,
    },
  },

  chat: {
    description: 'two-table chat: rooms + messages, with per-room reactive queries',
    files: {
      'briven/schema.ts': `import { schema, table, text, timestamp } from '@briven/cli/schema';

export default schema({
  rooms: table({
    id: text().primaryKey(),
    name: text().notNull(),
    createdAt: timestamp().default('now()').notNull(),
  }),
  messages: table({
    id: text().primaryKey(),
    roomId: text().notNull(),
    authorName: text().notNull(),
    body: text().notNull(),
    createdAt: timestamp().default('now()').notNull(),
  }),
});
`,
      'briven/functions/listRooms.ts': `import { query, type Ctx } from '@briven/cli/server';

export default query(async (ctx: Ctx) => {
  return ctx.db('rooms').select(['id', 'name', 'createdAt']).orderBy('createdAt', 'desc').limit(200);
});
`,
      'briven/functions/listMessages.ts': `import { brivenError, query, type Ctx } from '@briven/cli/server';

interface Args {
  roomId: string;
  limit?: number;
}

export default query(async (ctx: Ctx, args: Args) => {
  if (!args.roomId)
    throw new brivenError('validation_failed', 'roomId is required', { status: 400 });
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  return ctx
    .db('messages')
    .select(['id', 'roomId', 'authorName', 'body', 'createdAt'])
    .where({ roomId: args.roomId })
    .orderBy('createdAt', 'desc')
    .limit(limit);
});
`,
      'briven/functions/createRoom.ts': `import { brivenError, mutation, type Ctx } from '@briven/cli/server';
import { ulid } from '@briven/shared';

interface Args {
  name: string;
}

export default mutation(async (ctx: Ctx, args: Args) => {
  const name = args.name?.trim();
  if (!name) throw new brivenError('validation_failed', 'name is required', { status: 400 });
  if (name.length > 64)
    throw new brivenError('validation_failed', 'name too long (max 64 chars)', { status: 400 });

  const id = ulid('rm');
  const [row] = await ctx.db('rooms').insert({ id, name }).returning();
  return row;
});
`,
      'briven/functions/sendMessage.ts': `import { brivenError, mutation, type Ctx } from '@briven/cli/server';
import { ulid } from '@briven/shared';

interface Args {
  roomId: string;
  authorName: string;
  body: string;
}

export default mutation(async (ctx: Ctx, args: Args) => {
  if (!args.roomId)
    throw new brivenError('validation_failed', 'roomId is required', { status: 400 });
  const author = args.authorName?.trim();
  const body = args.body?.trim();
  if (!author)
    throw new brivenError('validation_failed', 'authorName is required', { status: 400 });
  if (!body) throw new brivenError('validation_failed', 'body is required', { status: 400 });
  if (body.length > 2000)
    throw new brivenError('validation_failed', 'body too long (max 2000 chars)', { status: 400 });

  const [room] = await ctx.db('rooms').select(['id']).where({ id: args.roomId }).limit(1);
  if (!room) throw new brivenError('not_found', \`no room \${args.roomId}\`, { status: 404 });

  const id = ulid('msg');
  const [row] = await ctx
    .db('messages')
    .insert({ id, roomId: args.roomId, authorName: author, body })
    .returning();
  return row;
});
`,
    },
  },
};

const GITIGNORE_ENTRIES = ['.briven/', 'node_modules/', 'dist/'];

function parse(argv: readonly string[]): Args {
  const out: Args = { force: false, template: 'blank', list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name' && argv[i + 1]) out.name = argv[++i];
    else if (a === '--template' && argv[i + 1]) {
      const t = argv[++i] as TemplateName;
      if (!(t in TEMPLATES)) {
        // Defer error to runInit so we can show the template list.
        out.template = t;
      } else {
        out.template = t;
      }
    } else if (a?.startsWith('--template=')) {
      out.template = a.slice('--template='.length) as TemplateName;
    } else if (a === '--force') out.force = true;
    else if (a === '--list-templates') out.list = true;
    else if (!a?.startsWith('-') && !out.name) out.name = a;
  }
  return out;
}

function printTemplates(): void {
  banner('templates');
  blankLine();
  for (const [key, tpl] of Object.entries(TEMPLATES)) {
    step(`${key.padEnd(12)} ${tpl.description}`);
  }
  blankLine();
  step('use one with: briven init --template <name>');
}

export async function runInit(argv: readonly string[]): Promise<number> {
  const args = parse(argv);
  if (args.list) {
    printTemplates();
    return 0;
  }
  if (!(args.template in TEMPLATES)) {
    printError(`unknown template '${args.template}'`);
    blankLine();
    printTemplates();
    return 1;
  }

  const cwd = process.cwd();
  const existing = await readProjectConfig(cwd);
  if (existing && !args.force) {
    printError('briven.json already exists — pass --force to overwrite.');
    return 1;
  }

  const name = args.name ?? basename(cwd);
  const tpl = TEMPLATES[args.template];

  banner('init');
  step(`creating briven project '${name}' (template: ${args.template})`);

  await writeProjectConfig({ name }, cwd);
  for (const [path, contents] of Object.entries(tpl.files)) {
    const abs = resolve(cwd, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, contents);
  }
  await updateGitignore(cwd);

  success('scaffolded:');
  step('  briven.json');
  for (const path of Object.keys(tpl.files)) {
    step(`  ${path}`);
  }
  blankLine();
  step('next: create a project in the dashboard, then run');
  step('      briven login --project <id> --key <brk_...>');
  step('      briven link');
  step('      briven deploy');
  link('https://docs.briven.tech/cli');
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

// Exported for tests.
export { TEMPLATES, parse as parseInitArgs };
