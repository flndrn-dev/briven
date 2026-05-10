import Link from 'next/link';

import { DocsShell } from '../../../components/shell';

export const metadata = { title: 'migration · postgres → briven' };

export default function PostgresMigrationPage() {
  return (
    <DocsShell>
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        <Link href="/migration" className="hover:text-[var(--color-text)]">
          ← migration
        </Link>
      </p>
      <h1 className="mt-2 font-mono text-2xl tracking-tight">raw postgres / drizzle / prisma → briven</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        the straightest path. you already have a postgres schema; briven gives you reactive
        queries, function hosting, and a managed deploy story on top of it. follow the
        ten-step playbook on{' '}
        <Link href="/migration" className="underline underline-offset-2">
          /migration
        </Link>{' '}
        — this page documents the postgres-specific parts.
      </p>

      <Section title="schema port — drizzle / prisma → briven dsl">
        <p>your existing column types map directly. drizzle:</p>
        <Snippet>{`// drizzle
export const notes = pgTable('notes', {
  id: text('id').primaryKey(),
  body: text('body').notNull(),
  authorId: text('author_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// briven
import { schema, table, text, timestamp } from '@briven/cli/schema';
export default schema({
  notes: table({
    columns: {
      id: text().primaryKey(),
      body: text().notNull(),
      authorId: text().references('users', 'id'),
      createdAt: timestamp().notNull().default('now()'),
    },
  }),
});`}</Snippet>
        <p>prisma:</p>
        <Snippet>{`// prisma
model Note {
  id         String   @id @default(cuid())
  body       String
  authorId   String?
  author     User?    @relation(fields: [authorId], references: [id])
  createdAt  DateTime @default(now())
}

// briven
notes: table({
  columns: {
    id: text().primaryKey(),
    body: text().notNull(),
    authorId: text().references('users', 'id'),  // FK relation flattens to a column ref
    createdAt: timestamp().notNull().default('now()'),
  },
}),`}</Snippet>
        <p>conventions to know:</p>
        <ul className="list-disc pl-5">
          <li>
            <strong>column casing.</strong> briven dsl is camelCase in TS; the generated SQL is
            snake_case-by-convention. if your existing tables already use snake_case, the
            migration is zero-diff at the SQL layer.
          </li>
          <li>
            <strong>indexes</strong> live on the table&apos;s <code>indexes: [...]</code> array,
            not chained on the column. compound + unique indexes go here.
          </li>
          <li>
            <strong>generated columns</strong> (drizzle <code>$generated()</code>, postgres{' '}
            <code>GENERATED ALWAYS AS</code>) aren&apos;t modelled in the dsl yet — declare the
            column as <code>text()</code>/<code>integer()</code>, then add the GENERATED clause
            via a custom migration step.
          </li>
        </ul>
      </Section>

      <Section title="query layer — drizzle/prisma → ctx.db">
        <p>
          briven&apos;s <code>ctx.db</code> is a focused query builder, not a full ORM. the
          90% of select / insert / update / delete patterns translate directly:
        </p>
        <Snippet>{`// drizzle
const rows = await db.select().from(notes).where(eq(notes.authorId, id)).orderBy(desc(notes.createdAt)).limit(50);

// briven
const rows = await ctx.db('notes')
  .select()
  .where({ authorId: id })
  .orderBy('createdAt', 'desc')
  .limit(50);`}</Snippet>
        <p>
          for the remaining 10% — joins, CTEs, window functions, full-text — drop to{' '}
          <code>ctx.db.execute(sql, params)</code> with a parameterised SQL string. see{' '}
          <Link href="/functions" className="underline underline-offset-2">/functions</Link> for
          the full <code>Ctx</code> shape.
        </p>
      </Section>

      <Section title="data port — pg_dump | pg_restore">
        <p>
          since briven&apos;s data plane is also postgres, the data move is a pg_dump pipe.
          briven creates a per-project schema (<code>proj_&lt;projectId&gt;</code>); your
          existing <code>public</code> schema lands inside it.
        </p>
        <Snippet>{`# 1. open a short-lived dsn into the briven project's schema
briven db shell-token > /tmp/briven-dsn   # writes a single-line dsn

# 2. dump source, restore into briven, scoped to public
pg_dump --schema=public --no-owner --no-privileges \\
  --format=custom \\
  "$SOURCE_DATABASE_URL" \\
  | pg_restore --no-owner --no-privileges \\
      --schema=public \\
      --dbname="$(cat /tmp/briven-dsn)"

# 3. verify row counts match
psql "$SOURCE_DATABASE_URL"           -tAc 'select count(*) from notes'
psql "$(cat /tmp/briven-dsn)"          -tAc 'select count(*) from public.notes'`}</Snippet>
        <p>
          the briven dsn is short-lived (15 minutes per issuance) — issue a fresh one if your
          dump runs longer.
        </p>
      </Section>

      <Section title="functions port — drizzle/prisma handlers → briven functions">
        <p>
          your existing API handlers (express, fastify, hono, next.js api routes) become files
          under <code>briven/functions/</code>. one file per endpoint:
        </p>
        <Snippet>{`// before: express + drizzle
app.get('/api/notes', async (req, res) => {
  const rows = await db.select().from(notes).where(eq(notes.authorId, req.user.id));
  res.json({ notes: rows });
});

// after: briven/functions/getNotes.ts
import { query, type Ctx } from '@briven/cli/server';
export default query(async (ctx: Ctx) => {
  if (!ctx.auth) throw new Error('unauthorized');
  return await ctx.db('notes').select().where({ authorId: ctx.auth.userId });
});`}</Snippet>
        <p>
          the wrapping framework goes away — briven owns the http surface. invoke from the
          client via <code>briven invoke getNotes</code>, or via the SDK&apos;s reactive{' '}
          <code>useQuery</code>.
        </p>
      </Section>

      <Section title="auth port">
        <p>
          if you were rolling your own auth on top of postgres (sessions table + cookie + bcrypt),
          Better Auth gives you the same primitives without the maintenance burden. magic-link
          + email/password + GitHub OAuth ship out of the box; bring your{' '}
          <code>users.id</code> column over and Better Auth keeps using it.
        </p>
      </Section>
    </DocsShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-mono text-lg">{title}</h2>
      <div className="mt-2 space-y-3 font-mono text-sm text-[var(--color-text-muted)]">
        {children}
      </div>
    </section>
  );
}

function Snippet({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs">
      <code>{children}</code>
    </pre>
  );
}
