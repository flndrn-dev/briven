import { DocsShell } from '../../../components/shell';

export const metadata = {
  title: 'doltgres version control',
};

export default function DoltgresVersionControlPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">version control</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        DoltGres is Postgres that branches, commits, and merges like Git — but the
        unit of versioning is the whole database, not a file. Every operation is a
        SQL function you call with <code>SELECT</code>.
      </p>

      <h2 className="mt-12 font-mono text-lg">the model: working → staged → committed</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        Like Git, DoltGres tracks three tiers of change. A normal{' '}
        <code>INSERT</code>/<code>UPDATE</code>/<code>DELETE</code> lands in the{' '}
        <strong className="text-[var(--color-text)]">working set</strong> — your
        uncommitted edits. You <strong className="text-[var(--color-text)]">stage</strong>{' '}
        the changes you want to keep, then{' '}
        <strong className="text-[var(--color-text)]">commit</strong> them to permanent,
        named history.
      </p>
      <ul className="mt-3 list-inside list-disc font-mono text-sm text-[var(--color-text-muted)]">
        <li>
          <strong className="text-[var(--color-text)]">working set</strong> — uncommitted,
          unstaged edits. Each branch has its own working set, so changes stay isolated.
        </li>
        <li>
          <strong className="text-[var(--color-text)]">staged</strong> — changes added with{' '}
          <code>dolt_add</code>, queued for the next commit.
        </li>
        <li>
          <strong className="text-[var(--color-text)]">committed</strong> — a permanent,
          hashed snapshot of the <em>entire</em> database state, linked to its parent commit.
        </li>
      </ul>

      <Callout title="gotcha: a Dolt commit is NOT a SQL transaction COMMIT">
        These are two different things that both happen to be called &ldquo;commit&rdquo;.
        A SQL <code>COMMIT</code> just ends a database transaction — it makes your writes
        durable in the working set. A <strong className="text-[var(--color-text)]">Dolt
        commit</strong> (<code>SELECT dolt_commit(...)</code>) creates a versioned snapshot
        in history with an author, message, and content hash. You can run a thousand SQL
        transactions and still have zero Dolt commits. To capture a point in history, you
        must take a Dolt commit explicitly.
      </Callout>

      <h2 className="mt-12 font-mono text-lg">the golden rule: SELECT, never CALL</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        DoltGres speaks the PostgreSQL dialect, and Postgres allows side-effects inside a{' '}
        <code>SELECT</code> (the same way <code>nextval()</code> does). So every mutating
        version-control operation is a <strong className="text-[var(--color-text)]">function
        invoked with <code>SELECT</code></strong>:
      </p>
      <Snippet>{`SELECT dolt_commit('-a', '-m', 'add notes table');   -- DoltGres (Postgres)`}</Snippet>
      <p className="mt-1 font-mono text-xs text-[var(--color-text-subtle)]">
        If you have seen MySQL-flavored Dolt, this is the one thing to unlearn: MySQL Dolt
        uses <code>CALL dolt_commit(...)</code>. DoltGres does not — it is always{' '}
        <code>SELECT dolt_xxx(...)</code>.
      </p>

      <h2 className="mt-12 font-mono text-lg">the mutating functions</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        Each returns a small result — a status, and/or a commit hash and message. The core
        set:
      </p>
      <div className="mt-3 overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
        <table className="w-full border-collapse font-mono text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-left text-[var(--color-text)]">
              <th className="p-3">function</th>
              <th className="p-3">example</th>
              <th className="p-3">returns</th>
            </tr>
          </thead>
          <tbody className="text-[var(--color-text-muted)]">
            <FnRow fn="dolt_add" ex="SELECT dolt_add('-A');" ret="status" />
            <FnRow fn="dolt_commit" ex="SELECT dolt_commit('-a','-m','msg');" ret="hash" />
            <FnRow fn="dolt_checkout" ex="SELECT dolt_checkout('-b','feat');" ret="status, message" />
            <FnRow fn="dolt_branch" ex="SELECT dolt_branch('-c','main','feat');" ret="status" />
            <FnRow
              fn="dolt_merge"
              ex="SELECT dolt_merge('feat','--no-ff','-m','msg');"
              ret="hash, fast_forward, conflicts, message"
            />
            <FnRow fn="dolt_reset" ex="SELECT dolt_reset('--hard','<hash>');" ret="status" />
            <FnRow fn="dolt_tag" ex="SELECT dolt_tag('v1','HEAD');" ret="status" />
          </tbody>
        </table>
      </div>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        The same <code>SELECT dolt_xxx(...)</code> convention covers the rest of the surface
        too — <code>dolt_revert</code>, <code>dolt_cherry_pick</code>, <code>dolt_rebase</code>,{' '}
        <code>dolt_stash</code>, <code>dolt_clean</code>, and{' '}
        <code>dolt_verify_constraints</code>.
      </p>

      <h2 className="mt-12 font-mono text-lg">end-to-end: branch → change → commit → merge</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        A realistic workflow. Make a feature branch, edit data on it, commit the snapshot,
        switch back to <code>main</code>, and merge the branch in.
      </p>
      <Snippet>{`-- 1. create a feature branch off main and switch to it
SELECT dolt_checkout('-b', 'add-welcome-note');

-- 2. make changes (ordinary SQL — these land in the working set)
INSERT INTO notes (id, body) VALUES ('n_001', 'welcome to briven');

-- 3. stage everything and commit a snapshot of the whole database
SELECT dolt_add('-A');
SELECT dolt_commit('-m', 'seed welcome note');   -- returns the new commit hash

-- 4. go back to main
SELECT dolt_checkout('main');

-- 5. merge the feature branch in (--no-ff forces a real merge commit)
SELECT dolt_merge('add-welcome-note', '--no-ff', '-m', 'merge welcome note');`}</Snippet>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        <code>dolt_merge</code> returns a row with <code>hash</code>,{' '}
        <code>fast_forward</code>, <code>conflicts</code>, and <code>message</code>. If{' '}
        <code>conflicts</code> is non-zero, the merge stopped and is waiting for you to
        resolve them (see below). A fast-forward merge — where <code>main</code> had no new
        commits since the branch point — moves the pointer forward and creates no merge
        commit unless you pass <code>--no-ff</code>.
      </p>

      <h2 className="mt-12 font-mono text-lg">reading state: system tables</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        Writes are functions; reads are tables. DoltGres exposes version-control state as
        tables in the <code>dolt</code> schema, each with a{' '}
        <code>dolt_</code>-prefixed alias you can use unqualified. This{' '}
        <code>dolt.</code> schema namespace is the main DoltGres-specific divergence from
        MySQL Dolt (which only has the <code>dolt_</code> prefixed names).
      </p>
      <Snippet>{`-- what is staged / unstaged right now
SELECT * FROM dolt.status;

-- every branch, its head commit, latest committer + message
SELECT * FROM dolt.branches;

-- commit history reachable from the current HEAD
SELECT * FROM dolt.commits WHERE date < '2026-01-01';

-- the same tables are reachable via the dolt_ aliases:
SELECT * FROM dolt_status;
SELECT * FROM dolt_branches;`}</Snippet>

      <h2 className="mt-12 font-mono text-lg">conflicts</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        DoltGres merges cell-by-cell. A conflict happens when both branches changed the{' '}
        <em>same</em> cell to different values. Unlike Git, conflicts are not written as{' '}
        inline <code>&lt;&lt;&lt;&lt;&lt;</code> markers in a file — they are recorded in a
        per-table system table: <code>dolt_conflicts_&lt;table&gt;</code>. Each conflicted
        cell shows three values:
      </p>
      <ul className="mt-3 list-inside list-disc font-mono text-sm text-[var(--color-text-muted)]">
        <li><strong className="text-[var(--color-text)]">base</strong> — the original common-ancestor value</li>
        <li><strong className="text-[var(--color-text)]">ours</strong> — the current branch&apos;s value</li>
        <li><strong className="text-[var(--color-text)]">theirs</strong> — the merging branch&apos;s value</li>
      </ul>
      <Snippet>{`-- inspect the conflicts on a specific table
SELECT * FROM dolt_conflicts_notes;

-- resolve by keeping the current branch's version of every conflicted row
SELECT dolt_conflicts_resolve('--ours', 'notes');

-- ...or keep the incoming branch's version
SELECT dolt_conflicts_resolve('--theirs', 'notes');`}</Snippet>
      <Callout title="resolving conflicts does not guarantee a valid merge">
        Merges happen at the storage layer, so combining two branches can still produce a
        database that violates a constraint (for example a foreign-key reference that only
        existed on one side). &ldquo;Zero conflicts&rdquo; is not the same as &ldquo;valid
        merge.&rdquo; After resolving, run{' '}
        <code>SELECT dolt_verify_constraints();</code> to surface any constraint violations
        the merge introduced before you commit it.
      </Callout>

      <h2 className="mt-12 font-mono text-lg">info functions</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        Read-only helpers for answering &ldquo;where am I?&rdquo; and &ldquo;how do these
        two branches relate?&rdquo;
      </p>
      <Snippet>{`-- which branch is this session on?
SELECT active_branch();

-- the common-ancestor commit of two branches (their merge base)
SELECT dolt_merge_base('main', 'add-welcome-note');`}</Snippet>

      <h2 className="mt-12 font-mono text-lg">what to read next</h2>
      <ul className="mt-3 flex flex-col gap-2 font-mono text-sm">
        <NextLink
          href="/doltgres/history"
          title="history + time travel"
          body="AS OF queries, the commit log, and per-table history, diff, and blame"
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
    <div className="mt-4 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning)]/10 p-4 font-mono text-sm text-[var(--color-text-muted)]">
      <p className="font-semibold text-[var(--color-warning)]">{title}</p>
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

function FnRow({ fn, ex, ret }: { fn: string; ex: string; ret: string }) {
  return (
    <tr className="border-b border-[var(--color-border-subtle)] last:border-0">
      <td className="p-3 align-top text-[var(--color-text)]">
        <code>{fn}</code>
      </td>
      <td className="p-3 align-top">
        <code>{ex}</code>
      </td>
      <td className="p-3 align-top">{ret}</td>
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
