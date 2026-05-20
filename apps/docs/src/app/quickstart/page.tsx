import { PmTabs } from '../../components/pm-tabs';
import { DocsShell } from '../../components/shell';
import { pmExec, pmInstall, pmJoin, pmPlain } from '../../lib/pm';

export const metadata = {
  title: 'quickstart',
};

const SCAFFOLD = pmJoin(
  pmPlain('$ mkdir my-app && cd my-app'),
  pmExec('npx @briven/cli   # wizard: browser auth + new-or-existing project + template pick'),
);

const INSTALL_CLIENT = pmInstall('@briven/react');

const DEPLOY = pmExec('briven deploy');

export default function QuickstartPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">quickstart</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        from nothing to a live reactive query in five minutes.
      </p>

      <ol className="mt-8 flex flex-col gap-6 font-mono text-sm text-[var(--color-text-muted)]">
        <Step n={1} title="create a project in the dashboard">
          Sign in at <a className="underline" href="https://briven.tech">briven.tech</a>, click{' '}
          <em>new project</em>, copy the resulting project id (looks like{' '}
          <code>p_01HZ…</code>).
          <div className="mt-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 text-xs">
            <strong className="text-[var(--color-text)]">dashboard-only path:</strong> if you
            want to avoid the CLI entirely, open the project&apos;s <em>studio</em> tab and
            click <em>+ new table</em> — define columns, set PKs/FKs/indexes, then insert rows
            and run queries from the SQL editor. The <em>copy as schema.ts</em> button
            graduates you to CLI + git when you&apos;re ready. The steps below describe the
            CLI flow.
          </div>
        </Step>
        <Step n={2} title="generate an api key">
          Open <em>api keys</em> on the new project and create one — pick the{' '}
          <code>developer</code> role for local iteration. The plaintext (
          <code>brk_…</code>) is shown once; store it in a secret manager immediately.
        </Step>
        <Step n={3} title="scaffold locally">
          <PmTabs commands={SCAFFOLD} />
          <p className="mt-1 text-[var(--color-text-subtle)]">
            <code>briven init</code> drops three files: <code>briven.config.ts</code>,{' '}
            <code>briven/schema.ts</code>, and <code>briven/functions/notes.ts</code>. The default{' '}
            template is a minimal notes app you can deploy as-is. Use{' '}
            <code>briven init --template=todo-app</code> or <code>--template=chat</code> for richer
            starting points.
          </p>
        </Step>
        <Step n={4} title="edit the schema + function">
          <p>
            Open <code>briven/schema.ts</code>:
          </p>
          <Snippet>{`import { schema, table, text, timestamp } from '@briven/schema';

export default schema({
  notes: table({
    columns: {
      id: text().primaryKey(),
      body: text().notNull(),
      createdAt: timestamp().notNull().defaultNow(),
    },
    indexes: [{ columns: ['createdAt'] }],
  }),
});`}</Snippet>
          <p>
            Open <code>briven/functions/notes.ts</code>:
          </p>
          <Snippet>{`import { mutation, query } from '@briven/cli/server';

export const list = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db('notes')
      .select(['id', 'body', 'createdAt'])
      .orderBy('createdAt', 'desc')
      .limit(100);
  },
});

export const create = mutation({
  args: { body: 'string' },
  handler: async (ctx, args) => {
    const id = crypto.randomUUID();
    await ctx.db('notes').insert({
      id,
      body: args.body,
      createdAt: new Date(),
    });
    return { id };
  },
});`}</Snippet>
        </Step>
        <Step n={5} title="deploy">
          <PmTabs commands={DEPLOY} />
          <p className="mt-1">
            The CLI prints a schema diff, applies it transactionally on the data plane, uploads the
            function bundle, and signals the runtime to swap in the new isolate. New row appears
            under <em>deployments</em> on the dashboard.
          </p>
        </Step>
        <Step n={6} title="wire it up from your app">
          <PmTabs commands={INSTALL_CLIENT} />
          <p className="mt-1">
            In your app (Next.js, Vite, Remix — anything React):
          </p>
          <Snippet>{`// app/providers.tsx
'use client';
import { BrivenProvider, createClient } from '@briven/react';

const client = createClient({
  projectId: 'p_01HZ...',
  apiKey: process.env.NEXT_PUBLIC_BRIVEN_PUBLIC_KEY!,  // 'brk_pub_...'
});

export function Providers({ children }: { children: React.ReactNode }) {
  return <BrivenProvider client={client}>{children}</BrivenProvider>;
}

// app/notes/page.tsx
'use client';
import { useMutation, useQuery } from '@briven/react';

export default function Notes() {
  const { data, isLoading } = useQuery('notes:list', {});
  const create = useMutation('notes:create');

  if (isLoading) return <p>loading…</p>;
  return (
    <div>
      {data?.map(n => <p key={n.id}>{n.body}</p>)}
      <button onClick={() => create.mutate({ body: 'hello' })}>add</button>
    </div>
  );
}`}</Snippet>
          <p className="mt-1">
            On <em>add</em>, briven inserts the row, the realtime service picks up the postgres{' '}
            NOTIFY for the <code>notes</code> table, re-invokes every active{' '}
            <code>notes:list</code> subscription, and pushes the fresh result — no polling, no
            manual cache invalidation.
          </p>
        </Step>
      </ol>

      <h2 className="mt-12 font-mono text-lg">what just happened</h2>
      <ul className="mt-3 list-inside list-disc font-mono text-sm text-[var(--color-text-muted)]">
        <li>
          <code>briven deploy</code> compiled your TypeScript schema to a postgres migration and ran it
          transactionally — if any column add failed, no rows changed.
        </li>
        <li>
          Your function bundle was uploaded to the runtime and assigned a fresh Deno isolate. Cold
          start budget: 200ms p50.
        </li>
        <li>
          On every <code>useQuery</code> on the client, briven&apos;s realtime service registered a{' '}
          LISTEN on every postgres table the function read — so any subsequent mutation that touches{' '}
          those tables triggers an automatic re-invoke.
        </li>
      </ul>

      <h2 className="mt-12 font-mono text-lg">what to read next</h2>
      <ul className="mt-3 flex flex-col gap-2 font-mono text-sm">
        <NextLink
          href="/schema"
          title="schema"
          body="every column type, constraint, index, default, and diff semantic"
        />
        <NextLink
          href="/functions"
          title="functions"
          body="query/mutation/action wrappers, Ctx, db builder, lifecycle, error handling"
        />
        <NextLink
          href="/cli"
          title="cli"
          body="every command — deploy, dev (watch + hot reload), env, db, logs, invoke, projects"
        />
        <NextLink
          href="/migration"
          title="migration"
          body="moving from convex, supabase, postgres/drizzle/prisma, firebase, hasura, nextauth"
        />
      </ul>
    </DocsShell>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-text-inverse)]">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[var(--color-text)]">{title}</p>
        <div className="mt-1 space-y-2">{children}</div>
      </div>
    </li>
  );
}

function Snippet({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs">
      <code>{children}</code>
    </pre>
  );
}

function NextLink({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <li>
      <a
        href={href}
        className="block rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-border)]"
      >
        <p className="font-mono text-[var(--color-text)]">{title}</p>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">{body}</p>
      </a>
    </li>
  );
}
