import { DocsShell } from '../../components/shell';

export const metadata = { title: 'functions' };

export default function FunctionsPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">functions</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        every file under <code>briven/functions/</code> becomes an invocable endpoint at{' '}
        <code>/v1/projects/:id/functions/:name</code>. functions run in a deno isolate per
        project, with a typed db client and the project&apos;s env vars injected.
      </p>

      <Section title="hello world">
        <p>
          file name = function name. wrap your handler with <code>query</code>,{' '}
          <code>mutation</code>, or <code>action</code> from <code>@briven/cli/server</code>:
        </p>
        <Snippet>{`// briven/functions/getNotes.ts
import { query, type Ctx } from '@briven/cli/server';

interface Args {
  authorId: string;
}

export default query(async (ctx: Ctx, args: Args) => {
  const rows = await ctx
    .db('notes')
    .select(['id', 'body', 'createdAt'])
    .where({ authorId: args.authorId })
    .orderBy('createdAt', 'desc')
    .limit(50);
  return { notes: rows };
});`}</Snippet>
        <p>
          invoke locally after deploy with <code>briven invoke getNotes --body &apos;{`{"authorId":"u_..."}`}&apos;</code>.
        </p>
      </Section>

      <Section title="client sdks">
        <p>
          framework hooks/stores/composables for invoking briven functions and subscribing to
          their reactive results:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <code>@briven/client</code> — framework-agnostic browser client (vanilla JS).{' '}
            <code>createBrivenClient({`{...}`})</code> returns an object with{' '}
            <code>.invoke()</code> and <code>.subscribe()</code>.
          </li>
          <li>
            <code>@briven/react</code> — <code>BrivenProvider</code> +{' '}
            <code>useQuery</code> / <code>useMutation</code> hooks.
          </li>
          <li>
            <code>@briven/svelte</code> — <code>setBrivenClient</code> at boot;{' '}
            <code>query</code> / <code>mutation</code> return Svelte stores.
          </li>
          <li>
            <code>@briven/vue</code> — same surface, Vue 3 composables returning <code>Ref</code>s.
          </li>
        </ul>
      </Section>

      <Section title="query vs. mutation vs. action">
        <ul className="list-disc pl-5">
          <li>
            <code>query()</code> — read-only. participates in the realtime subscription pipeline:
            calling <code>useQuery(&quot;getNotes&quot;, args)</code> from the client will{' '}
            re-run the function whenever a row changes in any table the function read.
          </li>
          <li>
            <code>mutation()</code> — writes. wrapped in a transaction. the realtime fan-out fires
            on commit.
          </li>
          <li>
            <code>action()</code> — for outbound side effects (calling an external api, sending an
            email). actions can&apos;t participate in subscriptions; their result isn&apos;t cached.
          </li>
        </ul>
      </Section>

      <Section title="the Ctx object">
        <p>every handler receives a typed <code>ctx</code> as its first argument:</p>
        <Snippet>{`interface Ctx {
  db: DbClient;        // typed query builder, project-scoped
  requestId: string;   // stable per request, correlated in logs
  log: Logger;         // structured json logger; never log customer data
  env: Readonly<Record<string, string | undefined>>;
  auth: { userId: string; tokenType: 'session' | 'api_key' } | null;
}`}</Snippet>
      </Section>

      <Section title="db builder">
        <p>
          <code>ctx.db(table)</code> returns a chainable builder. the surface is a focused subset
          — the 90% path of select / insert / update / delete:
        </p>
        <Snippet>{`// select
await ctx.db('notes').select(['id', 'body']).where({ status: 'pinned' });

// insert (returning is optional)
const [row] = await ctx.db('notes').insert({ id, body }).returning();

// update
await ctx.db('notes').update({ status: 'archived' }).where({ id });

// delete
await ctx.db('notes').delete().where({ id });

// raw escape hatch for anything the builder doesn't cover
await ctx.db.execute('select count(*) from notes where created_at > $1', [cutoff]);`}</Snippet>
      </Section>

      <Section title="common patterns">
        <p>
          recipes for the things you&apos;ll write five times a week. all of them stay inside
          the supported builder surface above — drop to <code>ctx.db.execute</code> only when
          the case truly is one-off.
        </p>

        <h3 className="mt-4 font-mono text-sm text-[var(--color-text)]">cursor pagination</h3>
        <p>
          offset pagination breaks for fast-changing feeds (rows shift between pages). cursor
          off the indexed sort column instead — typically <code>createdAt</code>:
        </p>
        <Snippet>{`interface Args { cursor?: string; limit?: number }

export default query(async (ctx, args: Args = {}) => {
  const limit = Math.min(args.limit ?? 50, 200);
  let q = ctx.db('posts').select(['id', 'body', 'createdAt']);
  if (args.cursor) q = q.where('createdAt', '<', new Date(args.cursor));
  const rows = await q.orderBy('createdAt', 'desc').limit(limit + 1);
  const next = rows.length > limit ? rows[limit - 1].createdAt.toISOString() : null;
  return { rows: rows.slice(0, limit), nextCursor: next };
});`}</Snippet>

        <h3 className="mt-4 font-mono text-sm text-[var(--color-text)]">case-insensitive search</h3>
        <p>
          for prefix / fuzzy match across a small column use <code>ilike</code>; for full-text
          search at scale, add a generated <code>tsvector</code> column and an index.
        </p>
        <Snippet>{`interface Args { q: string }

export default query(async (ctx, args: Args) => {
  const needle = '%' + args.q.replace(/[%_]/g, '') + '%';
  return ctx.db('posts')
    .select(['id', 'title'])
    .where('title', 'ilike', needle)
    .orderBy('createdAt', 'desc')
    .limit(50);
});`}</Snippet>

        <h3 className="mt-4 font-mono text-sm text-[var(--color-text)]">transactional mutation</h3>
        <p>
          every mutation already runs inside a transaction — the runtime wraps your handler.
          throws roll back the whole thing. if you need to fail explicitly, throw a{' '}
          <code>brivenError</code> (see <em>errors</em> below).
        </p>
        <Snippet>{`export default mutation(async (ctx, args: { fromId: string; toId: string; amount: number }) => {
  await ctx.db('accounts').decrement('balance', args.amount).where({ id: args.fromId });
  await ctx.db('accounts').increment('balance', args.amount).where({ id: args.toId });
  // both updates commit together. if the second throws, the first is rolled back.
});`}</Snippet>

        <h3 className="mt-4 font-mono text-sm text-[var(--color-text)]">user logs</h3>
        <p>
          <code>ctx.log(msg, fields?)</code> writes a structured entry to{' '}
          <code>function_logs.user_logs_json</code>. it&apos;s the only thing surfaced in the
          dashboard&apos;s logs tab, so use it instead of <code>console.log</code>:
        </p>
        <Snippet>{`export default mutation(async (ctx, args: { orderId: string }) => {
  const order = await ctx.db('orders').select(['*']).where({ id: args.orderId }).first();
  ctx.log('processing order', { orderId: order.id, total: order.totalCents });
  // the dashboard logs tab will show this entry.
});`}</Snippet>

        <h3 className="mt-4 font-mono text-sm text-[var(--color-text)]">caller identity</h3>
        <p>
          <code>ctx.auth</code> is populated from the bearer key / session. use it as the
          identity input to your authorization checks; never trust args for who the caller is.
        </p>
        <Snippet>{`export default query(async (ctx) => {
  if (!ctx.auth) throw new brivenError('unauthorized', 'sign in to view', { status: 401 });
  return ctx.db('notes').select(['id', 'body']).where({ ownerId: ctx.auth.userId });
});`}</Snippet>
      </Section>

      <Section title="env vars">
        <p>
          set with <code>briven env put KEY value</code>. read inside a function as{' '}
          <code>ctx.env.KEY</code>. encrypted at rest, decrypted only when the runtime spawns an
          isolate, never logged.
        </p>
      </Section>

      <Section title="errors">
        <p>
          throw to fail. the runtime serialises the error as <code>{`{ ok: false, code, message }`}</code>{' '}
          and returns a 500. throw a structured error to set <code>code</code>:
        </p>
        <Snippet>{`import { brivenError } from '@briven/shared';

export default mutation(async (ctx, args) => {
  if (!args.body?.trim()) {
    throw new brivenError('validation_failed', 'body is required', { status: 400 });
  }
  // ...
});`}</Snippet>
      </Section>

      <Section title="lifecycle + scaling">
        <p>
          one deno isolate per project, warm-cached and pooled. cold start is under 200ms p50.
          isolates are killed and replaced on crash, after 10 minutes idle, or after 1,000
          invocations — whichever trips first. there is no cross-project state in any isolate.
        </p>
        <p>
          outbound network is denied by default for rfc1918 (private), link-local, and the cloud
          metadata endpoints. customer functions can call any public endpoint; bring up an
          allowlist via the dashboard if you need stricter egress.
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
