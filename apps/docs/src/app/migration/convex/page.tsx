import Link from 'next/link';

import { DocsShell } from '../../../components/shell';

export const metadata = { title: 'migration · convex → briven' };

export default function ConvexMigrationPage() {
  return (
    <DocsShell>
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        <Link href="/migration" className="hover:text-[var(--color-text)]">
          ← migration
        </Link>
      </p>
      <h1 className="mt-2 font-mono text-2xl tracking-tight">convex → briven</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        port a convex.dev project onto briven. follow the ten-step playbook on{' '}
        <Link href="/migration" className="underline underline-offset-2">
          /migration
        </Link>{' '}
        — this page documents only the convex-specific parts.
      </p>

      <Section title="schema port — the 90% rules">
        <p>convex types map to briven schema dsl as follows:</p>
        <Snippet>{`// convex/schema.ts
defineTable({
  email: v.string(),
  status: v.union(v.literal('pending'), v.literal('active')),
  createdAt: v.int64(),
  ownerId: v.id('users'),
  isPrimary: v.boolean(),
});

// briven/schema.ts
import { bigint, boolean, schema, table, text } from '@briven/cli/schema';
export default schema({
  notes: table({
    columns: {
      email: text().notNull(),
      status: text().notNull(),                   // union → text + app-level validation
      createdAt: bigint().notNull(),               // int64 / number → bigint (ms-since-epoch)
      ownerId: text().references('users', 'id'),  // v.id() → text + foreign key
      isPrimary: boolean().notNull(),
    },
  }),
});`}</Snippet>
        <ul className="list-disc pl-5">
          <li>
            <code>v.union(v.literal(...))</code> — no enum helper today; use{' '}
            <code>text()</code> and validate at the function layer.
          </li>
          <li>
            <code>v.int64()</code> + <code>v.number()</code> for timestamps and money in cents
            both → <code>bigint()</code>.
          </li>
          <li>
            <code>v.id(&apos;users&apos;)</code> → <code>text().references(&apos;users&apos;, &apos;id&apos;)</code>.
          </li>
          <li>
            <code>v.optional(X)</code> → drop the <code>.notNull()</code>.
          </li>
          <li>
            convex&apos;s implicit <code>_creationTime</code> doesn&apos;t carry over — add an
            explicit <code>createdAt: bigint().notNull()</code> if you need it.
          </li>
          <li>
            indexes that convex declares with <code>.index(&quot;by_owner&quot;, [&quot;ownerId&quot;])</code>{' '}
            move to the table&apos;s <code>indexes: [{`{ columns: ['ownerId'] }`}]</code> array.
          </li>
        </ul>
      </Section>

      <Section title="functions port">
        <p>
          convex&apos;s <code>query()</code> / <code>mutation()</code> / <code>action()</code>{' '}
          map 1:1 onto the same names from <code>@briven/cli/server</code>:
        </p>
        <Snippet>{`// convex/notes.ts
export const getNotes = query({
  args: { authorId: v.id('users') },
  handler: async (ctx, args) => {
    return await ctx.db.query('notes').withIndex('by_owner', q => q.eq('ownerId', args.authorId)).collect();
  },
});

// briven/functions/getNotes.ts
import { query, type Ctx } from '@briven/cli/server';
export default query(async (ctx: Ctx, args: { authorId: string }) => {
  return await ctx.db('notes').select().where({ ownerId: args.authorId });
});`}</Snippet>
        <p>differences to know about up front:</p>
        <ul className="list-disc pl-5">
          <li>
            <strong>file = function name.</strong> briven discovers functions by file basename;
            export the handler as <code>default</code>. one function per file. convex packs many
            into one file, so you&apos;ll split.
          </li>
          <li>
            <strong>no validators in the wrapper.</strong> convex&apos;s <code>args:</code>{' '}
            schemas don&apos;t exist; validate with zod inside the handler.
          </li>
          <li>
            <strong>ctx.db is a typed query builder, not a sql escape hatch.</strong> see{' '}
            <Link href="/functions" className="underline underline-offset-2">
              /functions
            </Link>{' '}
            for the surface. for the rare query the builder doesn&apos;t cover, use{' '}
            <code>ctx.db.execute(&apos;…&apos;, params)</code>.
          </li>
          <li>
            <strong>no scheduler primitives yet.</strong> convex&apos;s{' '}
            <code>ctx.scheduler.runAfter(...)</code> isn&apos;t in briven phase 1; use a{' '}
            <code>pg_cron</code> entry or a brief sleep-and-poll loop in an action() handler
            until the scheduler lands.
          </li>
        </ul>
      </Section>

      <Section title="data export from convex">
        <p>
          convex ships an export command that dumps every table to a single zip:
        </p>
        <Snippet>{`npx convex export --path ./convex-backup-$(date +%Y%m%d).zip`}</Snippet>
        <p>
          unzip and treat each per-table json file as a stream — the rows match the briven
          column names you defined above. the import path is currently a small node script;{' '}
          <code>briven import --from-convex &lt;zip&gt;</code> arrives with the public beta.
        </p>
      </Section>

      <Section title="auth port">
        <p>
          convex auth (clerk / auth0 / custom) doesn&apos;t carry over — briven uses Better
          Auth with magic-link + email/password + GitHub OAuth out of the box. plan for a
          one-time forced sign-in on the cutover; users keep their email-as-identity but get
          a fresh session.
        </p>
        <p>
          if you need to preserve <code>userId</code> stability across the cut, set the
          briven user&apos;s <code>id</code> to the convex user id during the data-import step
          rather than letting briven mint a new ULID.
        </p>
      </Section>

      <Section title="reactivity">
        <p>
          briven&apos;s <code>useQuery(&quot;getNotes&quot;, args)</code> on the client matches
          convex&apos;s shape — same hook signature. under the hood briven runs LISTEN/NOTIFY
          per touched table; convex uses its mutation log. tail latency is comparable; for
          burst patterns where convex&apos;s log shines, briven realtime is a refactor target,
          not a regression today.
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
