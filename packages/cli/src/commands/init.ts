import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';

import { readProjectConfig, writeProjectConfig } from '../project-config.js';
import { banner, blankLine, error as printError, link, step, success } from '../output.js';

// The CLI pins the scaffold to its own version so a freshly-inited project
// installs the matching `@briven/cli` (mirrors commands/version.ts).
const cliRequire = createRequire(import.meta.url);
const CLI_VERSION = (cliRequire('../../package.json') as { version: string }).version;

interface Args {
  name?: string;
  template: TemplateName;
  force: boolean;
  list: boolean;
}

type TemplateName =
  | 'blank'
  | 'todo-app'
  | 'chat'
  | 'convex-notes'
  | 'supabase-auth-todos';

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
    done: boolean().default('false').notNull(),
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
      'briven/functions/createTodo.ts': `import { brivenError, mutation, ulid, type Ctx } from '@briven/cli/server';

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
      'briven/functions/createRoom.ts': `import { brivenError, mutation, ulid, type Ctx } from '@briven/cli/server';

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
      'briven/functions/sendMessage.ts': `import { brivenError, mutation, ulid, type Ctx } from '@briven/cli/server';

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

  /**
   * convex-notes — mirrors the canonical convex notes-app shape. Multi-
   * user notes, per-user reactive listing, optional tag filter. The
   * useQuery hook signature on the client matches convex 1:1, so
   * porting a convex notes app feels familiar.
   */
  'convex-notes': {
    description: 'convex-style notes app: multi-user notes with per-user reactive listing',
    files: {
      'briven/schema.ts': `import { schema, table, text, timestamp } from '@briven/cli/schema';

export default schema({
  notes: table({
    id: text().primaryKey(),
    ownerId: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    tag: text().nullable(),
    createdAt: timestamp().default('now()').notNull(),
    updatedAt: timestamp().default('now()').notNull(),
  }),
});
`,
      'briven/functions/listNotes.ts': `import { brivenError, query, type Ctx } from '@briven/cli/server';

interface Args {
  ownerId: string;
  tag?: string | null;
}

export default query(async (ctx: Ctx, args: Args) => {
  if (!args.ownerId)
    throw new brivenError('validation_failed', 'ownerId is required', { status: 400 });
  let q = ctx
    .db('notes')
    .select(['id', 'title', 'body', 'tag', 'createdAt', 'updatedAt'])
    .where({ ownerId: args.ownerId });
  if (args.tag) q = q.where({ tag: args.tag });
  return q.orderBy('updatedAt', 'desc').limit(200);
});
`,
      'briven/functions/createNote.ts': `import { brivenError, mutation, ulid, type Ctx } from '@briven/cli/server';

interface Args {
  ownerId: string;
  title: string;
  body: string;
  tag?: string | null;
}

export default mutation(async (ctx: Ctx, args: Args) => {
  if (!args.ownerId)
    throw new brivenError('validation_failed', 'ownerId is required', { status: 400 });
  const title = args.title?.trim();
  const body = args.body?.trim();
  if (!title) throw new brivenError('validation_failed', 'title is required', { status: 400 });
  if (title.length > 200)
    throw new brivenError('validation_failed', 'title too long (max 200 chars)', { status: 400 });
  if (body.length > 20000)
    throw new brivenError('validation_failed', 'body too long (max 20000 chars)', { status: 400 });

  const id = ulid('nt');
  const [row] = await ctx
    .db('notes')
    .insert({ id, ownerId: args.ownerId, title, body, tag: args.tag ?? null })
    .returning();
  return row;
});
`,
      'briven/functions/updateNote.ts': `import { brivenError, mutation, type Ctx } from '@briven/cli/server';

interface Args {
  id: string;
  ownerId: string;
  title?: string;
  body?: string;
  tag?: string | null;
}

export default mutation(async (ctx: Ctx, args: Args) => {
  if (!args.id) throw new brivenError('validation_failed', 'id is required', { status: 400 });
  if (!args.ownerId)
    throw new brivenError('validation_failed', 'ownerId is required', { status: 400 });

  // Ownership guard — equivalent to convex's "the user can only edit
  // their own notes" check; here we express it as an explicit where()
  // rather than a row-level policy.
  const [existing] = await ctx
    .db('notes')
    .select(['id', 'ownerId'])
    .where({ id: args.id })
    .limit(1);
  if (!existing) throw new brivenError('not_found', \`no note \${args.id}\`, { status: 404 });
  if (existing.ownerId !== args.ownerId)
    throw new brivenError('forbidden', 'not your note', { status: 403 });

  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (args.title !== undefined) patch.title = args.title.trim();
  if (args.body !== undefined) patch.body = args.body;
  if (args.tag !== undefined) patch.tag = args.tag;
  await ctx.db('notes').update(patch).where({ id: args.id });
  return { id: args.id, updated: true };
});
`,
      'briven/functions/deleteNote.ts': `import { brivenError, mutation, type Ctx } from '@briven/cli/server';

interface Args {
  id: string;
  ownerId: string;
}

export default mutation(async (ctx: Ctx, args: Args) => {
  if (!args.id) throw new brivenError('validation_failed', 'id is required', { status: 400 });
  if (!args.ownerId)
    throw new brivenError('validation_failed', 'ownerId is required', { status: 400 });
  const affected = await ctx
    .db('notes')
    .delete()
    .where({ id: args.id, ownerId: args.ownerId });
  if (affected === 0)
    throw new brivenError('not_found', 'no matching note (wrong id or owner)', { status: 404 });
  return { id: args.id, deleted: true };
});
`,
    },
  },

  /**
   * supabase-auth-todos — translates the canonical Supabase pattern
   * (user-scoped rows + row-level security) into briven's model: the
   * scoping happens explicitly inside the function via ctx.session.
   * Useful for supabase users who think in terms of "auth.uid() = row.user_id"
   * — here it's the same thing, just written out.
   */
  'supabase-auth-todos': {
    description: 'supabase-style auth-scoped todo list (RLS → explicit function guards)',
    files: {
      'briven/schema.ts': `import { boolean, schema, table, text, timestamp } from '@briven/cli/schema';

export default schema({
  todos: table({
    id: text().primaryKey(),
    userId: text().notNull(),
    body: text().notNull(),
    done: boolean().default('false').notNull(),
    createdAt: timestamp().default('now()').notNull(),
    completedAt: timestamp().nullable(),
  }),
});
`,
      'briven/functions/myTodos.ts': `import { brivenError, query, type Ctx } from '@briven/cli/server';

/**
 * Equivalent to Supabase's:
 *   create policy "users see their own todos"
 *     on todos for select using (auth.uid() = user_id);
 * — except the predicate lives in code, where you can read it.
 */
export default query(async (ctx: Ctx) => {
  if (!ctx.session?.userId)
    throw new brivenError('unauthorized', 'sign in required', { status: 401 });
  return ctx
    .db('todos')
    .select(['id', 'body', 'done', 'createdAt', 'completedAt'])
    .where({ userId: ctx.session.userId })
    .orderBy('createdAt', 'desc')
    .limit(500);
});
`,
      'briven/functions/createTodo.ts': `import { brivenError, mutation, ulid, type Ctx } from '@briven/cli/server';

interface Args {
  body: string;
}

export default mutation(async (ctx: Ctx, args: Args) => {
  if (!ctx.session?.userId)
    throw new brivenError('unauthorized', 'sign in required', { status: 401 });
  const body = args.body?.trim();
  if (!body) throw new brivenError('validation_failed', 'body is required', { status: 400 });
  if (body.length > 280)
    throw new brivenError('validation_failed', 'body too long (max 280 chars)', { status: 400 });

  const id = ulid('td');
  const [row] = await ctx
    .db('todos')
    .insert({ id, userId: ctx.session.userId, body, done: false })
    .returning();
  return row;
});
`,
      'briven/functions/toggleTodo.ts': `import { brivenError, mutation, type Ctx } from '@briven/cli/server';

interface Args {
  id: string;
}

export default mutation(async (ctx: Ctx, args: Args) => {
  if (!ctx.session?.userId)
    throw new brivenError('unauthorized', 'sign in required', { status: 401 });
  if (!args.id) throw new brivenError('validation_failed', 'id is required', { status: 400 });

  // Ownership guard equivalent to Supabase's update policy.
  const [existing] = await ctx
    .db('todos')
    .select(['id', 'done', 'userId'])
    .where({ id: args.id })
    .limit(1);
  if (!existing) throw new brivenError('not_found', \`no todo \${args.id}\`, { status: 404 });
  if (existing.userId !== ctx.session.userId)
    throw new brivenError('forbidden', 'not your todo', { status: 403 });

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
  if (!ctx.session?.userId)
    throw new brivenError('unauthorized', 'sign in required', { status: 401 });
  if (!args.id) throw new brivenError('validation_failed', 'id is required', { status: 400 });
  const affected = await ctx
    .db('todos')
    .delete()
    .where({ id: args.id, userId: ctx.session.userId });
  if (affected === 0)
    throw new brivenError('not_found', 'no matching todo (wrong id or not yours)', {
      status: 404,
    });
  return { id: args.id, deleted: true };
});
`,
    },
  },
};

/**
 * The package.json every scaffolded project needs. Two fields are what
 * separate "it just works" from the dreaded
 * "default export is not a valid briven schema":
 *   - "type": "module" — so tsx loads briven/schema.ts as a real ES module
 *     and the `export default schema({...})` isn't CJS-interop double-wrapped.
 *   - one dependency, @briven/cli — which bundles the schema DSL, the server
 *     helpers, brivenError, and ulid, so no private @briven/* package is
 *     ever needed.
 */
function packageJsonContents(name: string): string {
  return (
    JSON.stringify(
      {
        name,
        private: true,
        type: 'module',
        scripts: { deploy: 'briven deploy', dev: 'briven dev' },
        dependencies: { '@briven/cli': `^${CLI_VERSION}` },
      },
      null,
      2,
    ) + '\n'
  );
}

type PackageJsonResult = 'created' | 'exists-ok' | 'exists-no-esm';

/**
 * Write package.json for a fresh project. If one already exists (the user
 * ran `init` inside an existing app) we NEVER overwrite it — we only check
 * it declares `"type": "module"` and report back so the caller can warn,
 * because without it `briven deploy` fails to load the schema.
 */
async function ensurePackageJson(cwd: string, name: string): Promise<PackageJsonResult> {
  const path = resolve(cwd, 'package.json');
  let existing: string | null = null;
  try {
    existing = await readFile(path, 'utf8');
  } catch (err) {
    if (!isEnoent(err)) throw err;
  }
  if (existing === null) {
    await writeFile(path, packageJsonContents(name));
    return 'created';
  }
  try {
    const parsed = JSON.parse(existing) as { type?: string };
    return parsed.type === 'module' ? 'exists-ok' : 'exists-no-esm';
  } catch {
    // Unparseable package.json — leave it untouched, can't safely verify.
    return 'exists-ok';
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'ENOENT'
  );
}

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

/**
 * Templates are grouped so a user coming from convex / supabase sees
 * the starter that matches their mental model called out first. Order
 * within each group is stable and matches the order in TEMPLATES.
 */
const TEMPLATE_GROUPS: ReadonlyArray<{
  label: string;
  templates: readonly TemplateName[];
}> = [
  { label: 'starters', templates: ['blank', 'todo-app', 'chat'] },
  {
    label: 'migration-friendly',
    templates: ['convex-notes', 'supabase-auth-todos'],
  },
];

function printTemplates(): void {
  banner('templates');
  blankLine();
  const widest = Math.max(...Object.keys(TEMPLATES).map((k) => k.length));
  for (const group of TEMPLATE_GROUPS) {
    step(`${group.label}:`);
    for (const name of group.templates) {
      const tpl = TEMPLATES[name];
      step(`  ${name.padEnd(widest)}  ${tpl.description}`);
    }
    blankLine();
  }
  step('use one with: briven init --template <name>');
  step('migrating from convex / supabase? see https://briven.tech/migrate');
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
  const pkgResult = await ensurePackageJson(cwd, name);
  await updateGitignore(cwd);

  success('scaffolded:');
  step('  briven.json');
  if (pkgResult === 'created') step('  package.json');
  for (const path of Object.keys(tpl.files)) {
    step(`  ${path}`);
  }
  blankLine();
  if (pkgResult === 'exists-no-esm') {
    step('⚠  your existing package.json is missing "type": "module".');
    step('⚠  add it, otherwise `briven deploy` can fail to load briven/schema.ts.');
    blankLine();
  }
  step('next: install deps, create a project in the dashboard, then run');
  step('      npm install');
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
