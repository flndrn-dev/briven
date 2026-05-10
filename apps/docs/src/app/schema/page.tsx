import { DocsShell } from '../../components/shell';

export const metadata = { title: 'schema dsl' };

export default function SchemaPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">schema dsl</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        declare your project&apos;s postgres schema in typescript. <code>briven deploy</code> diffs
        the file against the currently-deployed schema, generates a migration, and applies it
        transactionally on the data plane.
      </p>

      <Section title="hello world">
        <p>
          A schema lives at <code>briven/schema.ts</code> and exports a default value built with
          the <code>schema()</code> helper. each table is constructed with <code>table()</code>,
          and columns are declared with the typed builders.
        </p>
        <Snippet>{`import { bigint, schema, table, text } from '@briven/cli/schema';

export default schema({
  users: table({
    columns: {
      id: text().primaryKey(),
      email: text().notNull(),
      createdAt: bigint().notNull(),
    },
    indexes: [{ columns: ['email'], unique: true }],
  }),
});`}</Snippet>
      </Section>

      <Section title="column types">
        <p>imported from <code>@briven/cli/schema</code>:</p>
        <ul className="list-disc pl-5">
          <li>
            <code>text()</code> — variable-length utf-8. the default for strings.
          </li>
          <li>
            <code>varchar(n)</code> — bounded text. n is required.
          </li>
          <li>
            <code>integer()</code> — int4, the default for whole numbers.
          </li>
          <li>
            <code>bigint()</code> — int8. use for timestamps-as-millis-since-epoch and money in
            cents.
          </li>
          <li>
            <code>boolean()</code>
          </li>
          <li>
            <code>timestamp()</code> — timestamptz. accepts a default like{' '}
            <code>.default(&apos;now()&apos;)</code>.
          </li>
          <li>
            <code>uuid()</code> — pg uuid. consider <code>text()</code> if you also use ulids.
          </li>
          <li>
            <code>jsonb()</code> — typed via the column generic:{' '}
            <code>jsonb&lt;{`{ enabled: boolean }`}&gt;()</code>.
          </li>
          <li>
            <code>vector(n)</code> — pgvector embedding column. n is the dimension.
          </li>
        </ul>
      </Section>

      <Section title="constraints">
        <p>chained on a column builder:</p>
        <ul className="list-disc pl-5">
          <li>
            <code>.primaryKey()</code> — at most one column per table; implies notNull + unique.
          </li>
          <li>
            <code>.notNull()</code>
          </li>
          <li>
            <code>.unique()</code> — single-column unique. for multi-column use{' '}
            <code>indexes</code>.
          </li>
          <li>
            <code>.default(value)</code> — a literal or postgres expression. quoted strings need
            the inner quotes (<code>.default(&quot;&apos;EUR&apos;&quot;)</code> renders as{' '}
            <code>DEFAULT &apos;EUR&apos;</code>).
          </li>
          <li>
            <code>.references(table, column, opts?)</code> — foreign key. <code>opts.onDelete</code>{' '}
            accepts <code>&apos;cascade&apos;</code> | <code>&apos;set null&apos;</code> |{' '}
            <code>&apos;restrict&apos;</code> | <code>&apos;no action&apos;</code>.
          </li>
        </ul>
      </Section>

      <Section title="indexes">
        <p>
          declared on the table, not on individual columns. multi-column indexes (compound or
          unique) live here:
        </p>
        <Snippet>{`uins: table({
  columns: {
    id: text().primaryKey(),
    uin: bigint().notNull(),
    ownerId: text().references('users', 'id'),
    status: text().notNull(),
  },
  indexes: [
    { columns: ['uin'], unique: true },
    { columns: ['status'] },
    { columns: ['ownerId', 'status'] },
  ],
}),`}</Snippet>
      </Section>

      <Section title="diff + apply">
        <p>
          <code>briven deploy</code> walks the schema, compares it to the previous snapshot, and
          emits one of these change kinds: <code>create_table</code>, <code>drop_table</code>,{' '}
          <code>add_column</code>, <code>drop_column</code>. drops are refused unless you pass{' '}
          <code>--confirm-destructive</code>; the cli also prints a pre-migration snapshot tag so
          you can roll back with <code>pg_restore</code> from the audit trail if something goes
          wrong.
        </p>
        <p>
          on apply, every table gets an implicit <code>NOTIFY</code> trigger that fires on
          insert/update/delete — that&apos;s what powers the realtime <code>useQuery</code> story
          on the client side.
        </p>
      </Section>

      <Section title="reserved names">
        <p>
          briven prefixes its own platform tables with <code>_briven_</code> on every project
          schema. you cannot define a table whose name starts with <code>_briven_</code>.
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
