import { DocsShell } from '../../../components/shell';

export const metadata = {
  title: 'doltgres history + time travel',
};

export default function DoltgresHistoryPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">history + time travel</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        Because DoltGres versions the whole database, every past state is still queryable.
        You can read a table as it looked at any commit, branch, or moment in time, walk the
        commit log, and ask &ldquo;who changed this exact row, and to what?&rdquo; — all in
        plain SQL.
      </p>

      <Callout title="an audit log you get for free">
        You do not have to build history tables, triggers, or change-data-capture. Every
        cell&apos;s full history is already recorded by the storage engine and queryable.
        The functions and tables on this page are how you read it.
      </Callout>

      <h2 className="mt-12 font-mono text-lg">time travel with AS OF</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        DoltGres supports SQL:2011-style <code>AS OF</code>. The operand is any valid
        reference — a commit hash, a branch name, or a timestamp — and it queries the table
        exactly as it existed at that point.
      </p>
      <Snippet>{`-- as of a specific commit hash
SELECT * FROM myTable AS OF 'kfvpgcf8pkd6blnkvv8e0kle8j6lug7a';

-- as of the head of another branch
SELECT * FROM myTable AS OF 'add-welcome-note';

-- as of a moment in time
SELECT * FROM myTable AS OF TIMESTAMP('2020-01-01');

-- even the schema is versioned
SHOW CREATE TABLE myTable AS OF 'add-welcome-note';`}</Snippet>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        Each table in a query can carry its own <code>AS OF</code> — so you can join
        today&apos;s <code>orders</code> against last month&apos;s <code>prices</code> in a
        single statement to see how a number would have looked.
      </p>

      <h2 className="mt-12 font-mono text-lg">the commit log</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        The commit history lives in the <code>dolt</code> schema. Read it like any table, or
        use the <code>DOLT_LOG</code> table function when you want to scope the walk to
        specific refs.
      </p>
      <Snippet>{`-- full history reachable from the current HEAD
SELECT * FROM dolt.log;

-- commits before a date (columns: commit_hash, committer, email, date, message)
SELECT * FROM dolt.commits WHERE date < '2026-01-01';

-- table function: commits on main that are NOT on feat
SELECT * FROM DOLT_LOG('main', '--not', 'feat');`}</Snippet>

      <h2 className="mt-12 font-mono text-lg">per-table history, diff &amp; blame</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        Every user table gets a family of companion system tables — DoltGres builds them
        automatically, named after your table. These are the workhorses of data forensics.
      </p>
      <div className="mt-3 overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
        <table className="w-full border-collapse font-mono text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-left text-[var(--color-text)]">
              <th className="p-3">system table</th>
              <th className="p-3">what it gives you</th>
            </tr>
          </thead>
          <tbody className="text-[var(--color-text-muted)]">
            <TblRow
              name="dolt_history_<table>"
              desc="Every version of every row across all commits — the full revision trail of the data."
            />
            <TblRow
              name="dolt_diff_<table>"
              desc="Row-level changes with to_/from_ column pairs and a diff_type of added, modified, or removed."
            />
            <TblRow
              name="dolt_commit_diff_<table>"
              desc="The diff between any two commits or branches — you pass the two refs as filters."
            />
            <TblRow
              name="dolt_blame_<table>"
              desc="Who last changed each row, in which commit, when, and with what message."
            />
          </tbody>
        </table>
      </div>
      <Snippet>{`-- the full history of one row's every value
SELECT * FROM dolt_history_employees WHERE id = 0 ORDER BY commit_date;

-- only the rows that were modified
SELECT * FROM dolt_diff_employees WHERE diff_type = 'modified';

-- diff one table between two refs (here: main vs the feat branch)
SELECT * FROM dolt_commit_diff_employees
WHERE from_commit = 'main' AND to_commit = 'feat';

-- who last touched each row
SELECT * FROM dolt_blame_employees LIMIT 5;`}</Snippet>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        In a <code>dolt_diff_&lt;table&gt;</code> row, uncommitted working-set changes show
        up with <code>to_commit = 'WORKING'</code>, so you can inspect pending edits the
        same way you inspect committed ones.
      </p>

      <h2 className="mt-12 font-mono text-lg">diff table functions</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        When you want a diff scoped by ref rather than reading the per-table system table,
        DoltGres ships table functions that return rows. Pass the two refs and (where
        relevant) a table name.
      </p>
      <Snippet>{`-- the per-row diff of mytable between two branches
SELECT * FROM DOLT_DIFF('main', 'feat', 'mytable');

-- a per-table summary of rows added / modified / deleted
SELECT * FROM DOLT_DIFF_STAT('main', 'feat');

-- a high-level "which tables changed" summary
SELECT * FROM DOLT_DIFF_SUMMARY('main', 'feat');`}</Snippet>

      <h2 className="mt-12 font-mono text-lg">what to read next</h2>
      <ul className="mt-3 flex flex-col gap-2 font-mono text-sm">
        <NextLink
          href="/doltgres/version-control"
          title="version control"
          body="branches, commits, merges, and conflicts — how to write the history this page reads"
        />
        <NextLink
          href="/undo"
          title="undo + snapshots"
          body="how briven turns commits and branches into one-click undo for your data"
        />
        <NextLink
          href="/doltgres/limitations"
          title="beta + limitations"
          body="what doltgres does and does not support yet"
        />
      </ul>
    </DocsShell>
  );
}

function Callout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-sm text-[var(--color-text-muted)]">
      <p className="font-semibold text-[var(--color-text)]">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Snippet({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs">
      <code>{children}</code>
    </pre>
  );
}

function TblRow({ name, desc }: { name: string; desc: string }) {
  return (
    <tr className="border-b border-[var(--color-border-subtle)] last:border-0">
      <td className="p-3 align-top text-[var(--color-text)]">
        <code>{name}</code>
      </td>
      <td className="p-3 align-top">{desc}</td>
    </tr>
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
