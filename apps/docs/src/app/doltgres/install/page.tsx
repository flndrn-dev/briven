import { DocsShell } from '../../../components/shell';

export const metadata = {
  title: 'doltgres — install + run',
};

export default function DoltgresInstallPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">install + run</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        get the DoltGres engine onto your machine, start the server on port 5432, and connect with
        psql.
      </p>

      <div className="mt-6 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        <strong className="text-[var(--color-text)]">do you actually need this?</strong> DoltGres is
        the engine underneath. On Briven (hosted) the database is provisioned, run, and managed for
        you — you never install or start it yourself. This page is for self-hosting or running
        DoltGres locally on your own machine.
      </div>

      <h2 className="mt-12 font-mono text-lg">1. install</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        DoltGres ships as a single binary called <code>doltgres</code>. Pick the path that matches
        your machine.
      </p>

      <div className="mt-6 flex flex-col gap-6 font-mono text-sm text-[var(--color-text-muted)]">
        <div>
          <p className="text-[var(--color-text)]">Linux / macOS</p>
          <Snippet>{`sudo bash -c 'curl -L https://github.com/dolthub/doltgresql/releases/latest/download/install.sh | bash'`}</Snippet>
        </div>

        <div>
          <p className="text-[var(--color-text)]">Windows</p>
          <p className="mt-1 text-[var(--color-text-subtle)]">
            Download the <code>.msi</code> installer from the{' '}
            <a className="underline" href="https://github.com/dolthub/doltgresql/releases">
              DoltGres GitHub releases page
            </a>{' '}
            and run it.
          </p>
        </div>

        <div>
          <p className="text-[var(--color-text)]">Docker</p>
          <Snippet>{`docker run -e DOLTGRES_PASSWORD=myPassword -p 5432:5432 dolthub/doltgresql:latest`}</Snippet>
        </div>

        <div>
          <p className="text-[var(--color-text)]">From source</p>
          <Snippet>{`./scripts/build.sh`}</Snippet>
        </div>
      </div>

      <h2 className="mt-12 font-mono text-lg">2. start the server</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        Run the binary to start the server:
      </p>
      <Snippet>{`doltgres`}</Snippet>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        On its very first run, DoltGres creates a default user <code>postgres</code>, a default
        database <code>postgres</code>, and a default password <code>password</code>. To set your
        own instead, define these environment variables{' '}
        <strong className="text-[var(--color-text)]">before the first run</strong>:
      </p>
      <Snippet>{`export DOLTGRES_USER=myUser
export DOLTGRES_PASSWORD=myPassword
doltgres`}</Snippet>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-subtle)]">
        DoltGres listens on port <code>5432</code> — the standard PostgreSQL port — and speaks the
        PostgreSQL wire protocol, so any PostgreSQL client can connect to it.
      </p>

      <h2 className="mt-12 font-mono text-lg">3. connect with psql</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        Connect with the standard PostgreSQL client, <code>psql</code>:
      </p>
      <Snippet>{`PGPASSWORD=password psql -h localhost -U postgres`}</Snippet>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        Or with a connection string:
      </p>
      <Snippet>{`postgres://postgres@localhost:5432/postgres`}</Snippet>

      <h2 className="mt-12 font-mono text-lg">connecting to a specific version</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        Because DoltGres is versioned, a database name can be{' '}
        <em>revision-qualified</em> — you append a revision (a branch name, a commit hash, or a tag)
        after the database name to open a read-only snapshot at exactly that point. You can do it in
        the connection string:
      </p>
      <Snippet>{`postgres://postgres@localhost:5432/mydb/<revision>`}</Snippet>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        Or switch to it inside an open session:
      </p>
      <Snippet>{`USE mydb/<revision>;`}</Snippet>

      <h2 className="mt-12 font-mono text-lg">what to read next</h2>
      <ul className="mt-3 flex flex-col gap-2 font-mono text-sm">
        <NextLink
          href="/doltgres"
          title="doltgres overview"
          body="what DoltGres is, and why Dolt (MySQL) is not DoltGres (PostgreSQL)"
        />
        <NextLink
          href="/doltgres/version-control"
          title="version control"
          body="branch, commit, diff, and merge your data with SELECT dolt_* functions"
        />
        <NextLink
          href="/doltgres/limitations"
          title="beta + limitations"
          body="DoltGres is pre-1.0 — here is what is still missing or slow"
        />
      </ul>
    </DocsShell>
  );
}

function Snippet({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs">
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
