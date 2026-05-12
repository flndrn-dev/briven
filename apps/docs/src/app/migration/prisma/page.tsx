import Link from 'next/link';

import { DocsShell } from '../../../components/shell';

export const metadata = { title: 'migration · prisma → briven' };

export default function PrismaMigrationPage() {
  return (
    <DocsShell>
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        <Link href="/migration" className="hover:text-[var(--color-text)]">
          ← migration
        </Link>
      </p>
      <h1 className="mt-2 font-mono text-2xl tracking-tight">prisma → briven</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        port a prisma + postgres project onto briven. follow the ten-step playbook on{' '}
        <Link href="/migration" className="underline underline-offset-2">
          /migration
        </Link>{' '}
        — this page covers only the prisma-specific parts.
      </p>

      <div className="mt-4 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        prisma&apos;s strengths (typed clients, sql-agnostic schema files) and weaknesses (long
        cold starts, awkward complex queries) are both reasons people move. on briven you keep
        the typed-client feel — every <code>query()</code> / <code>mutation()</code> is typed via
        its <code>Args</code> interface — and trade prisma client&apos;s ORM-level helpers for a
        thin postgres query builder. the schema port is mechanical; the functions port is the
        place to think.
      </div>

      <Section title="schema port — prisma DSL → briven DSL">
        <p>
          prisma uses its own schema language (<code>.prisma</code> files). map decorators to
          briven column-builder calls:
        </p>
        <Snippet>{`// schema.prisma
model Post {
  id          String   @id @default(cuid())
  authorId    String
  title       String
  body        String
  published   Boolean  @default(false)
  views       Int      @default(0)
  metadata    Json?
  createdAt   DateTime @default(now())
  author      User     @relation(fields: [authorId], references: [id])
  @@index([authorId])
  @@index([published, authorId])
}

// briven/schema.ts
import { bigint, boolean, jsonb, schema, table, text, timestamp } from '@briven/cli/schema';

export default schema({
  posts: table({
    columns: {
      id:        text().primaryKey(),
      authorId:  text().notNull().references('users', 'id'),
      title:     text().notNull(),
      body:      text().notNull(),
      published: boolean().notNull().default('false'),
      views:     bigint().notNull().default('0'),
      metadata:  jsonb<Record<string, unknown>>().nullable(),
      createdAt: timestamp().notNull().default('now()'),
    },
    indexes: [
      { columns: ['authorId'], unique: false },
      { columns: ['published', 'authorId'], unique: false },
    ],
  }),
});`}</Snippet>
        <ul className="list-disc pl-5">
          <li>
            <code>@id</code> → <code>.primaryKey()</code>. prisma&apos;s <code>@default(cuid())</code>{' '}
            / <code>@default(uuid())</code> don&apos;t carry over — briven mints ids in function
            code via <code>ulid(&apos;<em>prefix</em>&apos;)</code> from{' '}
            <code>@briven/shared</code>. ULIDs sort lexicographically by creation time, which is
            usually what you want anyway.
          </li>
          <li>
            <code>Int</code> → <code>bigint()</code>. prisma maps <code>Int</code> to int4 by
            default; briven defaults numeric columns to int8 to head off overflow. if you need
            int4 specifically, file an issue.
          </li>
          <li>
            <code>Json?</code> → <code>jsonb&lt;T&gt;().nullable()</code>. give the column a type
            arg so the function code gets typed reads.
          </li>
          <li>
            <code>DateTime @default(now())</code> →{' '}
            <code>timestamp().notNull().default(&apos;now()&apos;)</code>.
          </li>
          <li>
            <code>@relation(fields: […], references: […])</code> →{' '}
            <code>.references(&apos;table&apos;, &apos;column&apos;)</code> on the fk column.
            briven doesn&apos;t generate the reverse-side accessor — query through{' '}
            <code>ctx.db</code> on the related table directly.
          </li>
          <li>
            <code>@@index([a, b])</code> → entry in the table&apos;s <code>indexes</code> array.
            partial / expression indexes (e.g. <code>@@index([a], where: {'{ … }'})</code>) are a
            known gap.
          </li>
        </ul>
      </Section>

      <Section title="enums">
        <p>
          prisma <code>enum</code> declarations have no first-class briven equivalent today. two
          paths, depending on how strict you want the constraint:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <strong>application-side</strong> — column stays <code>text()</code>, the function
            code validates against a TypeScript union literal. less strict but flexible; matches
            how convex / nextauth migrations land.
          </li>
          <li>
            <strong>database-side</strong> — apply the enum as a check-constraint via a raw-sql
            migration after <code>briven deploy</code>. briven preserves untouched user objects on
            re-deploy, so the constraint survives.
          </li>
        </ul>
      </Section>

      <Section title="data export from prisma's postgres">
        <p>
          prisma is one of several clients pointing at postgres — the dump/restore is the same as
          the <Link href="/migration/postgres" className="underline underline-offset-2">raw-postgres playbook</Link>:
        </p>
        <Snippet>{`pg_dump --format=custom --no-owner --no-privileges \\
  "$PRISMA_DATABASE_URL" > prisma-dump-$(date +%Y%m%d).dump

pg_restore --no-owner --no-privileges --data-only \\
  -d "$BRIVEN_PROJECT_DSN" prisma-dump-$(date +%Y%m%d).dump`}</Snippet>
        <p>
          run <code>briven deploy</code> first so the briven schema is in place, then restore{' '}
          <code>--data-only</code>. that keeps briven&apos;s id naming + index naming in sync with
          what the briven dsl declared, instead of inheriting prisma&apos;s names.
        </p>
        <p>
          prisma&apos;s migration history table (<code>_prisma_migrations</code>) doesn&apos;t
          carry — briven tracks its own migrations in <code>_briven_migrations</code>. drop the
          prisma table after the cutover.
        </p>
      </Section>

      <Section title="functions port — PrismaClient calls → ctx.db chains">
        <p>
          prisma client is generated; briven&apos;s <code>ctx.db</code> is a thin knex-style
          builder. the port pattern is: replace <code>prisma.<em>model</em>.<em>op</em></code>{' '}
          with the equivalent builder chain.
        </p>
        <Snippet>{`// before — prisma handler
import { prisma } from './db';

export async function recentPostsByAuthor(authorId: string, limit = 50) {
  return prisma.post.findMany({
    where: { authorId, published: true },
    select: { id: true, title: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
  });
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
            <code>findMany</code> / <code>findFirst</code> / <code>findUnique</code> → builder
            chain ending in <code>.first()</code> for unique lookups.
          </li>
          <li>
            <code>create</code> / <code>update</code> / <code>delete</code> →{' '}
            <code>insert / update / delete</code>. <code>upsert</code> needs an explicit{' '}
            <code>onConflict</code> in raw sql today (known gap; an upsert helper is queued).
          </li>
          <li>
            <code>include</code> / <code>select</code> with nested relations → no eager-join
            shortcut yet. either run two queries inside the same function (the function executes
            in one transaction, so the consistency is the same) or write a raw query for the
            joined shape.
          </li>
          <li>
            prisma <code>$transaction</code> → not needed; every <code>mutation()</code> body
            runs in a single transaction by default.
          </li>
        </ul>
      </Section>

      <Section title="auth port">
        <p>
          prisma is unopinionated about auth — the user table is whatever you built. if it lines
          up with better-auth&apos;s columns (<code>id, email, name, image, …</code>) the{' '}
          <Link href="/migration/nextauth" className="underline underline-offset-2">
            nextauth → briven
          </Link>{' '}
          guide maps cleanly; if it&apos;s a custom shape, port the columns onto better-auth&apos;s
          expected shape before flipping traffic.
        </p>
      </Section>

      <Section title="reactivity (new capability)">
        <p>
          prisma queries are one-shot; the typical pattern is polling or websockets-on-the-side.
          on briven the same <code>query()</code> used over http auto-becomes reactive when
          consumed via <code>@briven/react</code>&apos;s <code>useQuery</code>. table-level
          NOTIFYs trigger re-runs — no code change needed.
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
