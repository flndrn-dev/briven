import { DocsShell } from '../../components/shell';

export const metadata = {
  title: 'doltgres',
};

export default function DoltgresPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">doltgres</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        a PostgreSQL-wire database you can branch, commit, diff, merge, and time-travel like Git —
        &ldquo;Git for your data.&rdquo; <strong className="text-[var(--color-text)]">Briven is
        Doltgres-first:</strong> it powers <em>both</em> the platform control database and every
        project database (not only “the data plane”).
      </p>

      <div className="mt-6 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        <strong className="text-[var(--color-text)]">heads up — DoltGres is Beta.</strong> It is
        still pre-1.0 (1.0 is targeted around October 2026), runs roughly 5.2× slower than stock
        PostgreSQL today, and some PostgreSQL features are not implemented yet. It is solid enough
        to build on, but read{' '}
        <a className="underline" href="/doltgres/limitations">
          beta + limitations
        </a>{' '}
        before you lean on it for anything load-bearing.
      </div>

      <h2 className="mt-12 font-mono text-lg">what it is, in plain words</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        Think of a normal database as a single live document that only ever shows you the latest
        version. DoltGres is the same database, but with a full history attached — like Git for
        code, except the thing under version control is your <em>data</em>. You can take a snapshot
        (a <em>commit</em>), spin off a separate copy to experiment on (a <em>branch</em>), compare
        two versions side by side (a <em>diff</em>), fold changes back together (a <em>merge</em>),
        and ask &ldquo;what did this table look like last Tuesday?&rdquo; (<em>time travel</em>).
        Underneath, it is a real PostgreSQL database — your app talks to it the same way it talks to
        any Postgres.
      </p>

      <h2 className="mt-12 font-mono text-lg">Dolt is not DoltGres</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        This is the single most common point of confusion, so it is worth being crisp. There are
        two products from the same team, built on the same versioned storage engine, but they speak
        different languages:
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse font-mono text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text)]">
              <th className="py-2 pr-4 font-normal"> </th>
              <th className="py-2 pr-4 font-normal">Dolt</th>
              <th className="py-2 font-normal">DoltGres</th>
            </tr>
          </thead>
          <tbody className="text-[var(--color-text-muted)]">
            <tr className="border-b border-[var(--color-border-subtle)]">
              <td className="py-2 pr-4 text-[var(--color-text)]">dialect</td>
              <td className="py-2 pr-4">MySQL</td>
              <td className="py-2">PostgreSQL</td>
            </tr>
            <tr className="border-b border-[var(--color-border-subtle)]">
              <td className="py-2 pr-4 text-[var(--color-text)]">default port</td>
              <td className="py-2 pr-4">3306</td>
              <td className="py-2">5432</td>
            </tr>
            <tr className="border-b border-[var(--color-border-subtle)]">
              <td className="py-2 pr-4 text-[var(--color-text)]">client</td>
              <td className="py-2 pr-4">mysql</td>
              <td className="py-2">psql</td>
            </tr>
            <tr className="border-b border-[var(--color-border-subtle)]">
              <td className="py-2 pr-4 text-[var(--color-text)]">how you commit</td>
              <td className="py-2 pr-4">
                <code>CALL DOLT_COMMIT(...)</code>
              </td>
              <td className="py-2">
                <code>SELECT dolt_commit(...)</code>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-4 font-mono text-sm text-[var(--color-text-muted)]">
        The headline difference: in DoltGres, every version-control operation is a{' '}
        <strong className="text-[var(--color-text)]">function you call with </strong>
        <code>SELECT</code>, never <code>CALL</code> — for example{' '}
        <code>SELECT dolt_commit(&apos;-am&apos;, &apos;my message&apos;);</code>. PostgreSQL allows
        side effects inside a <code>SELECT</code> (the same way <code>nextval()</code> works), so
        DoltGres leans on that. Any DoltGres example you write or copy should use the{' '}
        <code>SELECT dolt_*</code> form on port <code>5432</code> with <code>psql</code>. If you see
        a <code>CALL</code> or port <code>3306</code>, that is MySQL Dolt, not DoltGres.
      </p>

      <h2 className="mt-12 font-mono text-lg">the superpowers</h2>
      <ul className="mt-3 flex flex-col gap-2 font-mono text-sm">
        <NextLink
          href="/doltgres/version-control"
          title="version control"
          body="branch, commit, diff, and merge your data with SELECT dolt_branch / dolt_commit / dolt_merge"
        />
        <NextLink
          href="/doltgres/history"
          title="history + time travel"
          body="query any past commit or timestamp with AS OF, and read the commit log from the dolt schema"
        />
        <NextLink
          href="/doltgres/types"
          title="types + sql support"
          body="which PostgreSQL types and SQL features work today, which are partial, and which are not in yet"
        />
        <NextLink
          href="/doltgres/limitations"
          title="beta + limitations"
          body="the honest list — what is pre-1.0, what is slow, and what PostgreSQL features are still missing"
        />
        <NextLink
          href="/doltgres/install"
          title="install + run"
          body="install the engine, start the server on port 5432, and connect with psql (self-host / local)"
        />
      </ul>

      <h2 className="mt-12 font-mono text-lg">what to read next</h2>
      <ul className="mt-3 flex flex-col gap-2 font-mono text-sm">
        <NextLink
          href="/doltgres/install"
          title="install + run"
          body="get DoltGres running locally and connect with psql in a couple of minutes"
        />
        <NextLink
          href="/doltgres/version-control"
          title="version control"
          body="the core Git-for-data workflow: branch, commit, diff, merge"
        />
        <NextLink
          href="/doltgres/limitations"
          title="beta + limitations"
          body="read this before you depend on DoltGres in production"
        />
      </ul>
    </DocsShell>
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
