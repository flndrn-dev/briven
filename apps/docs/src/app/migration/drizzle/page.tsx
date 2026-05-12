import Link from 'next/link';

import { DocsShell } from '../../../components/shell';

export const metadata = { title: 'migration · drizzle → briven' };

export default function DrizzleMigrationPage() {
  return (
    <DocsShell>
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        <Link href="/migration" className="hover:text-[var(--color-text)]">
          ← migration
        </Link>
      </p>
      <h1 className="mt-2 font-mono text-2xl tracking-tight">drizzle → briven</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        port a drizzle-orm + postgres project onto briven. follow the ten-step playbook on{' '}
        <Link href="/migration" className="underline underline-offset-2">
          /migration
        </Link>{' '}
        — this page covers only the drizzle-specific parts.
      </p>

      <div className="mt-4 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        drizzle is the closest source shape to briven&apos;s schema dsl — both target postgres
        with typescript-first definitions. the schema port is mostly a search/replace; the
        functions port is replacing the drizzle <code>db.select(...)</code> chains with briven&apos;s
        <code> ctx.db(...)</code> chains (same query-builder shape).
      </div>

      <Section title="schema port — direct mappings">
        <p>drizzle column helpers map to briven helpers as follows:</p>
        <Snippet>{`// drizzle/schema.ts
import { pgTable, text, boolean, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';

export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  authorId: text('author_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  published: boolean('published').notNull().default(false),
  views: integer('views').notNull().default(0),
  metadata: jsonb('metadata').$type<{ tags: string[] }>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// briven/schema.ts
import { bigint, boolean, jsonb, schema, table, text, timestamp } from '@briven/cli/schema';

export default schema({
  posts: table({
    columns: {
      id:        text().primaryKey(),
      authorId:  text().notNull().references('users', 'id'),
      title:     text().notNull(),
      published: boolean().notNull().default('false'),
      views:     bigint().notNull().default('0'),
      metadata:  jsonb<{ tags: string[] }>().nullable(),
      createdAt: timestamp().notNull().default('now()'),
    },
  }),
});`}</Snippet>
        <ul className="list-disc pl-5">
          <li>
            drizzle <code>integer()</code> → briven <code>bigint()</code> (briven defaults to int8
            for numeric counters to head off overflow).
          </li>
          <li>
            drizzle <code>jsonb&lt;T&gt;().$type&lt;T&gt;()</code> → briven{' '}
            <code>jsonb&lt;T&gt;()</code>. type assertion lives on the column builder in both.
          </li>
          <li>
            drizzle <code>.defaultNow()</code> → briven <code>.default(&apos;now()&apos;)</code>{' '}
            (we accept a string-literal sql default; <code>now()</code> is recognised verbatim).
          </li>
          <li>
            drizzle <code>.references(() =&gt; users.id)</code> → briven{' '}
            <code>.references(&apos;users&apos;, &apos;id&apos;)</code>. drizzle&apos;s closure
            form preserves circular-ref ordering; briven resolves by name so the order doesn&apos;t
            matter.
          </li>
          <li>
            drizzle uses <code>snake_case</code> column names in the second arg; briven derives
            the sql name from the property name (camelCase → snake_case) so you can drop the
            extra arg.
          </li>
        </ul>
      </Section>

      <Section title="indexes">
        <p>
          drizzle defines indexes via the third tuple arg on <code>pgTable</code>. briven uses an
          inline <code>indexes</code> array on the table def.
        </p>
        <Snippet>{`// drizzle
export const posts = pgTable('posts', { /* columns */ }, (t) => ({
  authorIdx: index('posts_author_idx').on(t.authorId),
  publishedAuthorIdx: index().on(t.published, t.authorId),
}));

// briven
posts: table({
  columns: { /* ... */ },
  indexes: [
    { columns: ['authorId'], unique: false },
    { columns: ['published', 'authorId'], unique: false },
  ],
});`}</Snippet>
        <p>
          drizzle&apos;s named indexes don&apos;t round-trip — briven generates names from
          <code> (table, columns)</code> so renaming a column auto-renames the index too. if a
          drizzle index was named for a specific reason (e.g. partial indexes via raw sql), open an
          issue; partial indexes are a known gap.
        </p>
      </Section>

      <Section title="data export from drizzle's postgres">
        <p>
          drizzle is just a query builder on top of postgres, so the export is the same as the{' '}
          <Link href="/migration/postgres" className="underline underline-offset-2">
            raw-postgres playbook
          </Link>
          :
        </p>
        <Snippet>{`pg_dump --format=custom --no-owner --no-privileges \\
  "$DRIZZLE_DATABASE_URL" > drizzle-dump-$(date +%Y%m%d).dump

pg_restore --no-owner --no-privileges \\
  -d "$BRIVEN_PROJECT_DSN" drizzle-dump-$(date +%Y%m%d).dump`}</Snippet>
        <p>
          briven&apos;s migration applies a clean schema first; <code>pg_restore</code> writes the
          data into the same tables. if the drizzle source had columns briven&apos;s dsl can&apos;t
          model yet (e.g. partial indexes, enum types, custom types), restore will warn — fix at
          the data level rather than retroactively changing the briven schema.
        </p>
      </Section>

      <Section title="functions port — query builder is nearly identical">
        <p>
          drizzle <code>db</code> and briven <code>ctx.db</code> share the postgres-query-builder
          shape (both lean on knex semantics). the port is a search/replace on the import + the
          handle name.
        </p>
        <Snippet>{`// before — drizzle handler
import { db } from './db';
import { posts, users } from './schema';
import { and, eq, desc } from 'drizzle-orm';

export async function recentPostsByAuthor(authorId: string, limit = 50) {
  return db
    .select({ id: posts.id, title: posts.title, createdAt: posts.createdAt })
    .from(posts)
    .where(and(eq(posts.authorId, authorId), eq(posts.published, true)))
    .orderBy(desc(posts.createdAt))
    .limit(limit);
}

// after — briven/functions/recentPostsByAuthor.ts
import { brivenError, query, type Ctx } from '@briven/cli/server';

interface Args { authorId: string; limit?: number }

export default query(async (ctx: Ctx, args: Args) => {
  if (!args.authorId)
    throw new brivenError('validation_failed', 'authorId required', { status: 400 });
  return ctx
    .db('posts')
    .select(['id', 'title', 'createdAt'])
    .where({ authorId: args.authorId, published: true })
    .orderBy('createdAt', 'desc')
    .limit(Math.min(args.limit ?? 50, 200));
});`}</Snippet>
        <ul className="list-disc pl-5">
          <li>
            drizzle <code>db.select({'{a, b}'})</code> → briven{' '}
            <code>ctx.db(&apos;table&apos;).select([&apos;a&apos;, &apos;b&apos;])</code>.
          </li>
          <li>
            drizzle&apos;s <code>and / eq / desc</code> operators → briven uses object-literal
            where clauses + string-keyed <code>orderBy</code> (knex-style). drizzle&apos;s richer
            operators (e.g. <code>ilike</code>, <code>arrayContains</code>) land on briven via
            raw fragments — see <Link href="/functions" className="underline underline-offset-2">/functions</Link>.
          </li>
          <li>
            drizzle <code>insert / update / delete</code> → briven{' '}
            <code>ctx.db(table).insert / update / delete</code> — same shape.
          </li>
        </ul>
      </Section>

      <Section title="auth port">
        <p>
          drizzle ships no auth — you&apos;re running it next to better-auth, lucia, next-auth, or
          a hand-rolled session table. briven ships better-auth integrated; map your existing user
          / session columns into briven&apos;s control-plane shape via the{' '}
          <Link href="/migration/nextauth" className="underline underline-offset-2">
            nextauth → briven
          </Link>{' '}
          guide (the same column-mapping applies whichever lib generated the rows).
        </p>
      </Section>

      <Section title="reactivity (new capability)">
        <p>
          drizzle queries are one-shot. once on briven, wrap a read as a <code>query()</code> and
          the same call from <code>@briven/react</code>&apos;s <code>useQuery</code> auto-refetches
          on table-level NOTIFYs. no extra code on the function side.
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
