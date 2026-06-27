import { DocsShell } from '../../../components/shell';

export const metadata = {
  title: 'doltgres types + sql support',
};

const FULLY: readonly [string, string][] = [
  ['int2 / int4 / int8', 'signed integers (smallint, integer, bigint)'],
  ['float4 / float8', 'single- and double-precision floats'],
  ['text', 'variable-length string, no length cap'],
  ['varchar', 'variable-length string'],
  ['boolean', 'true / false'],
  ['uuid', '128-bit identifier'],
  ['interval', 'time span'],
  ['array variants', 'all array types (e.g. int4[], text[])'],
  ['oid / regclass / regproc / regtype', 'object-identifier types'],
];

const PARTIAL: readonly [string, string][] = [
  ['numeric / decimal', 'works, but the precision/scale you declare is parsed and ignored'],
  ['bytea', 'binary data'],
  ['char', 'fixed-length string'],
  ['json', 'stored, queryable'],
  ['jsonb', 'stored, queryable'],
  ['date / time / timestamp', 'temporal values'],
  ['timestamptz / timetz', 'timezone-aware temporal values'],
];

const UNSUPPORTED: readonly [string, string][] = [
  ['SERIAL / smallserial / bigserial', 'auto-increment shorthand — use a sequence instead (below)'],
  ['range types', 'int4range, tsrange, etc.'],
  ['geometric', 'point, line, lseg, box, path, polygon, circle'],
  ['network', 'inet, cidr, macaddr'],
  ['tsvector / tsquery', 'full-text search types'],
  ['xml', 'XML document type'],
  ['money', 'currency type'],
];

export default function TypesPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">types + sql support</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        DoltGres speaks PostgreSQL. Most of the type system and DDL you already know works — but it
        is still Beta, so some types and statements are partial or missing. This page is the honest
        map of what lands today.
      </p>

      <Callout tone="warn">
        <strong className="text-[var(--color-text)]">Reaching for SERIAL?</strong> DoltGres does{' '}
        <strong>not</strong> support <code>SERIAL</code> / <code>smallserial</code> /{' '}
        <code>bigserial</code> yet — the first thing most Postgres users type. Use a{' '}
        <strong>sequence</strong> for auto-increment instead (see{' '}
        <a className="underline" href="#auto-increment">auto-increment without SERIAL</a> below).
      </Callout>

      <Section title="fully supported types">
        <p>
          These behave as you&apos;d expect from stock Postgres.
        </p>
        <TypeTable rows={FULLY} />
      </Section>

      <Section title="partially supported types">
        <p>
          These work, but with one important caveat: <strong>declared precision is parsed but NOT
          enforced</strong>. You can write <code>numeric(10,2)</code> or{' '}
          <code>timestamp(3)</code> and it will be accepted, but DoltGres does not currently round
          or constrain values to that precision. Treat the precision as documentation, not a
          guarantee.
        </p>
        <TypeTable rows={PARTIAL} />
      </Section>

      <Section title="not supported yet">
        <p>
          These Postgres types are not implemented at Beta. The biggest surprise for most users is{' '}
          <code>SERIAL</code> — handled separately just below.
        </p>
        <TypeTable rows={UNSUPPORTED} />
      </Section>

      <Section title="auto-increment without SERIAL" id="auto-increment">
        <p>
          <code>SERIAL</code> in Postgres is just shorthand for &quot;create a sequence and default
          this column to its next value.&quot; DoltGres supports <strong>sequences</strong> and
          sequence functions, so you wire that up by hand:
        </p>
        <Snippet>{`CREATE SEQUENCE notes_id_seq;

CREATE TABLE notes (
  id    int8 NOT NULL DEFAULT nextval('notes_id_seq') PRIMARY KEY,
  body  text NOT NULL
);`}</Snippet>
        <Callout tone="warn">
          One gotcha: <code>ALTER SEQUENCE</code> is <strong>not yet supported</strong>. Create the
          sequence with the start value and increment you want up front, because you can&apos;t
          retune it afterwards.
        </Callout>
      </Section>

      <Section title="roles + grants">
        <p>
          User and permission management is supported and — true to DoltGres — fully{' '}
          <strong>versioned</strong> alongside your data.
        </p>
        <ul className="mt-2 list-inside list-disc">
          <li>
            <code>CREATE USER</code>, <code>CREATE ROLE</code>
          </li>
          <li>
            <code>GRANT &lt;roles&gt; TO &lt;users&gt; [WITH ADMIN OPTION]</code>
          </li>
        </ul>
        <Snippet>{`CREATE ROLE editor;
CREATE USER alice;
GRANT editor TO alice WITH ADMIN OPTION;`}</Snippet>
        <p>
          What&apos;s <strong>missing</strong> today: column-level privileges, granting on object
          types other than tables, and impersonation (&quot;assume another user&quot;).
        </p>
      </Section>

      <Section title="other confirmed support">
        <p>
          Beyond the type system, these Postgres features are confirmed working at Beta:
        </p>
        <ul className="mt-2 list-inside list-disc">
          <li>
            <code>ON CONFLICT</code> (upserts)
          </li>
          <li>
            <code>INSERT … RETURNING</code>
          </li>
          <li>user-defined domain types</li>
          <li>
            <code>pg_catalog</code> (with some gaps)
          </li>
          <li>
            native extensions, including <strong>PostGIS</strong> and <code>uuid-ossp</code> (as of
            October 2025)
          </li>
        </ul>
      </Section>

      <Callout tone="info">
        <strong className="text-[var(--color-text)]">There&apos;s more not yet supported.</strong>{' '}
        CTEs, window functions, statement-level triggers and a handful of other features are still
        in progress. See{' '}
        <a className="underline" href="/doltgres/limitations">
          beta + limitations
        </a>{' '}
        for the full honest picture.
      </Callout>
    </DocsShell>
  );
}

function Section({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10" id={id}>
      <h2 className="font-mono text-lg">{title}</h2>
      <div className="mt-3 space-y-2 font-mono text-sm text-[var(--color-text-muted)]">
        {children}
      </div>
    </section>
  );
}

function TypeTable({ rows }: { rows: readonly [string, string][] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
      <table className="w-full border-collapse font-mono text-xs">
        <thead>
          <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-left">
            <th className="px-3 py-2 font-semibold text-[var(--color-text)]">type</th>
            <th className="px-3 py-2 font-semibold text-[var(--color-text)]">notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([type, note]) => (
            <tr key={type} className="border-b border-[var(--color-border-subtle)] last:border-0">
              <td className="px-3 py-2 align-top text-[var(--color-text)]">
                <code>{type}</code>
              </td>
              <td className="px-3 py-2 align-top text-[var(--color-text-muted)]">{note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Callout({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  const color = tone === 'warn' ? 'var(--color-warning)' : 'var(--color-primary)';
  return (
    <div
      className="mt-6 rounded-md border bg-[var(--color-surface)] p-4 font-mono text-sm text-[var(--color-text-muted)]"
      style={{ borderColor: color }}
    >
      {children}
    </div>
  );
}

function Snippet({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs">
      <code>{children}</code>
    </pre>
  );
}
