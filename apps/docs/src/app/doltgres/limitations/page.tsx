import { DocsShell } from '../../../components/shell';

export const metadata = {
  title: 'doltgres beta + limitations',
};

const NOT_YET: readonly [string, string][] = [
  ['Git-style CLI', 'version control is driven through the SQL interface only — no separate command-line tool yet'],
  ['push to DoltHub / DoltLab', 'only custom remotes work today (filesystem and S3)'],
  ['backup & replication', 'both are works in progress'],
  ['GSSAPI auth', 'not supported'],
  ['statement-level triggers', 'row-level triggers work; statement-level do not'],
  ['stored procedures', 'partial — described as "almost done" as of October 2025, not yet complete'],
  ['CTEs (WITH)', 'not supported at Beta'],
  ['window functions', 'not supported at Beta'],
  ['custom operators / indexing / aggregates', 'not supported at Beta'],
  ['multi-table single-statement UPDATE', 'updating several tables in one UPDATE is not supported'],
  ['ALTER SEQUENCE / COMMENT ON', 'these DDL statements are not yet supported'],
  ['collations', 'currently ignored'],
  ['some psql backslash commands', 'e.g. \\d <table> is not supported'],
];

export default function LimitationsPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">beta + limitations</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        DoltGres is in Beta. This page is the calm, honest list of what to expect — so nothing
        surprises you in production. The team ships fast, so treat this as a snapshot, not a
        permanent ceiling.
      </p>

      <Section title="where it is in its life">
        <ul className="mt-2 list-inside list-disc">
          <li>
            Still <strong>pre-1.0 Beta</strong>; 1.0 is targeted for around{' '}
            <strong>October 2026</strong>.
          </li>
          <li>
            Roughly <strong>5.2× slower than stock Postgres</strong> overall today (about 6.3× on
            reads, 3.6× on writes). DoltHub expects this gap to close well before 1.0.
          </li>
          <li>
            About <strong>91% correctness</strong> on the sqllogictest suite.
          </li>
          <li>
            The biggest open issue is <strong>general Postgres compatibility</strong>: there are
            still many unresolved <code>.pgdump</code> import failures, so importing an existing
            Postgres dump may not work cleanly yet.
          </li>
        </ul>
      </Section>

      <Section title="not yet supported">
        <p>
          The following are known gaps at Beta. (For the type system specifically — including the{' '}
          <code>SERIAL</code> gap — see{' '}
          <a className="underline" href="/doltgres/types">
            types + sql support
          </a>
          .)
        </p>
        <div className="mt-3 overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
          <table className="w-full border-collapse font-mono text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-left">
                <th className="px-3 py-2 font-semibold text-[var(--color-text)]">area</th>
                <th className="px-3 py-2 font-semibold text-[var(--color-text)]">status</th>
              </tr>
            </thead>
            <tbody>
              {NOT_YET.map(([area, status]) => (
                <tr
                  key={area}
                  className="border-b border-[var(--color-border-subtle)] last:border-0"
                >
                  <td className="px-3 py-2 align-top text-[var(--color-text)]">{area}</td>
                  <td className="px-3 py-2 align-top text-[var(--color-text-muted)]">{status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Callout tone="info">
        <strong className="text-[var(--color-text)]">What Beta IS good for.</strong> You can build
        and evaluate real solutions on DoltGres today — DoltHub explicitly frames Beta as &quot;you
        can begin building a production solution.&quot; The headline superpowers already work: branch,
        merge, fork, clone, diff, and time-travel over your data, all versioned the way Git versions
        code. If those are why you&apos;re here, they&apos;re here now. Just keep this page&apos;s
        gaps in mind, pin to a known-good version, and expect the rough edges to keep getting smoother.
      </Callout>
    </DocsShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-mono text-lg">{title}</h2>
      <div className="mt-3 space-y-2 font-mono text-sm text-[var(--color-text-muted)]">
        {children}
      </div>
    </section>
  );
}

function Callout({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  const color = tone === 'warn' ? 'var(--color-warning)' : 'var(--color-primary)';
  return (
    <div
      className="mt-8 rounded-md border bg-[var(--color-surface)] p-4 font-mono text-sm text-[var(--color-text-muted)]"
      style={{ borderColor: color }}
    >
      {children}
    </div>
  );
}
