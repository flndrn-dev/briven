import { DocsShell } from '../../components/shell';

export const metadata = { title: 'undo + snapshots' };

export default function UndoPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">undo + snapshots</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        briven runs on <strong>DoltGres</strong> — a postgres-compatible database with git-style
        version control built in. every change to your data can be saved, compared, and undone.
        it&apos;s the one thing the big no-code databases don&apos;t give you: a real undo button
        for your whole database.
      </p>

      <Section title="what it is (plain words)">
        <p>
          think of your database like a document you&apos;re editing. most databases only keep the
          <em> latest</em> version — change something by mistake and the old value is gone. briven
          keeps a <strong>history of save-points</strong> instead, like the save-points in a video
          game or the version history in a Google Doc.
        </p>
        <ul className="list-disc pl-5">
          <li>
            <strong>snapshot</strong> — a save-point of your entire database at a moment in time.
          </li>
          <li>
            <strong>undo / restore</strong> — jump your data back to any earlier save-point.
          </li>
          <li>
            <strong>history</strong> — see what changed, when, and roll back just the part you want.
          </li>
        </ul>
        <p>
          because nothing is ever truly overwritten, you can experiment fearlessly — there&apos;s
          always a way back.
        </p>
      </Section>

      <Section title="why briven is different">
        <p>
          neon, supabase and the rest give developers point-in-time backups, but no non-coder
          undo. briven&apos;s version history is a product feature, not a buried admin tool —
          surfaced in plain language so anyone can use it. that&apos;s possible because the engine
          underneath (DoltGres) treats <em>every commit like git does</em>: cheap, instant, and
          fully reversible.
        </p>
      </Section>

      <Section title="how to use it (no code)">
        <p>in the dashboard, open your project and use the <strong>Snapshots</strong> panel:</p>
        <ul className="list-disc pl-5">
          <li>
            <strong>take a snapshot</strong> before any big change (e.g. importing a spreadsheet).
            give it a name you&apos;ll recognise — &ldquo;before price update&rdquo;.
          </li>
          <li>
            <strong>automatic snapshots</strong> can run on a daily / twice-daily schedule with a
            &ldquo;keep the last N&rdquo; rule, so you always have recent save-points without
            thinking about it.
          </li>
          <li>
            <strong>restore</strong> picks a snapshot and rolls the whole project back to it. the
            current state is itself snapshotted first, so a restore is never a dead end.
          </li>
        </ul>
        <p>
          you never need to type a command. the sections below are for developers who want to know
          exactly what happens underneath, or who want to drive it from SQL.
        </p>
      </Section>

      <Section title="how it works under the hood — DoltGres">
        <p>
          <a
            href="https://www.doltgres.com/docs/introduction/"
            className="underline underline-offset-2 hover:text-[var(--color-text)]"
            target="_blank"
            rel="noreferrer"
          >
            DoltGres
          </a>{' '}
          is &ldquo;Git and Postgres had a baby&rdquo; — it speaks the postgres wire protocol (so
          briven&apos;s normal postgres drivers, <code>psql</code>, and your SQL all just work) but
          stores data the way{' '}
          <a
            href="https://www.dolthub.com/docs/introduction/what-is-dolt/"
            className="underline underline-offset-2 hover:text-[var(--color-text)]"
            target="_blank"
            rel="noreferrer"
          >
            Dolt
          </a>{' '}
          does: as a versioned commit graph. <em>Git versions files; Dolt versions tables.</em>
        </p>
        <p>
          briven turns on commit-on-write for every project database, so each saved transaction
          becomes its own undoable commit:
        </p>
        <Snippet>{`-- briven sets this on every data-plane connection:
SET dolt_transaction_commit = 1;

-- from then on, a normal write IS a version-controlled commit
INSERT INTO products (id, name, price) VALUES ('p1', 'Chair', 4900);
-- the database HEAD now points at a new commit containing that row`}</Snippet>
        <p>
          there is <strong>no DoltGres CLI</strong> — all version control is done through SQL
          functions and system tables. these are the ones briven&apos;s snapshot/undo features call
          for you:
        </p>
      </Section>

      <Section title="for developers — the SQL">
        <p>
          <strong>see the history</strong> of a project database (every commit, newest first):
        </p>
        <Snippet>{`SELECT commit_hash, committer, message, date
FROM   dolt_log
ORDER  BY date DESC;

-- the exact version the database is on right now:
SELECT DOLT_HASHOF('HEAD');`}</Snippet>

        <p>
          <strong>take a named snapshot</strong> (what the dashboard&apos;s &ldquo;take a
          snapshot&rdquo; button does):
        </p>
        <Snippet>{`-- stage everything + commit it as one save-point
SELECT DOLT_COMMIT('-A', '-m', 'before price update');

-- tag that commit with a friendly snapshot name
SELECT DOLT_TAG('before-price-update', 'HEAD', '-m', 'before price update');

-- list every snapshot/tag
SELECT tag_name, message, date FROM dolt_tags;`}</Snippet>

        <p>
          <strong>see exactly what changed</strong> between two points:
        </p>
        <Snippet>{`-- table-by-table summary of changes since the last commit
SELECT * FROM dolt_diff_summary('HEAD~1', 'HEAD');

-- row-level diff of one table between a snapshot and now
SELECT * FROM dolt_diff('before-price-update', 'HEAD', 'products');`}</Snippet>

        <p>
          <strong>undo / restore</strong> — roll the database back to a snapshot:
        </p>
        <Snippet>{`-- jump the whole database back to a named snapshot
SELECT DOLT_RESET('--hard', 'before-price-update');`}</Snippet>

        <p>
          <strong>experiment on a branch</strong> without touching live data, then merge if you
          like the result:
        </p>
        <Snippet>{`SELECT DOLT_BRANCH('experiment');     -- create a branch
SELECT DOLT_CHECKOUT('experiment');   -- switch to it
-- ...make changes safely...
SELECT DOLT_CHECKOUT('main');         -- back to live
SELECT DOLT_MERGE('experiment');      -- bring the good changes in`}</Snippet>
        <p>
          realtime note: DoltGres has no <code>LISTEN/NOTIFY</code>, so briven&apos;s realtime
          layer watches <code>DOLT_HASHOF(&apos;HEAD&apos;)</code> per project and pushes an update
          the moment a commit advances it — see <a className="underline underline-offset-2 hover:text-[var(--color-text)]" href="/realtime">realtime</a>.
        </p>
      </Section>

      <Section title="the dolt ecosystem (and what briven uses)">
        <p>three related projects share the same git-for-data engine. briven uses one of them:</p>
        <ul className="list-disc pl-5">
          <li>
            <strong>
              <a
                className="underline underline-offset-2 hover:text-[var(--color-text)]"
                href="https://www.dolthub.com/docs/introduction/what-is-dolt/"
                target="_blank"
                rel="noreferrer"
              >
                Dolt
              </a>
            </strong>{' '}
            — the original: a SQL database you can fork, clone, branch, merge, push and pull like a
            git repo. mysql-dialect. this is the <em>concept</em> briven&apos;s undo is built on.
          </li>
          <li>
            <strong>
              <a
                className="underline underline-offset-2 hover:text-[var(--color-text)]"
                href="https://www.doltgres.com/docs/introduction/"
                target="_blank"
                rel="noreferrer"
              >
                DoltGres
              </a>
            </strong>{' '}
            — the postgres-dialect version of Dolt. <strong>this is what briven runs</strong> for
            every customer&apos;s data, so the whole platform stays on the postgres protocol.
          </li>
          <li>
            <strong>
              <a
                className="underline underline-offset-2 hover:text-[var(--color-text)]"
                href="https://www.doltlab.com/docs/introduction/what-is-doltlab/"
                target="_blank"
                rel="noreferrer"
              >
                DoltLab
              </a>
            </strong>{' '}
            — a self-hosted, GitLab-style collaboration server for Dolt databases (a remote you
            push to, with pull-request review). it is <em>not</em> a database engine, and{' '}
            <strong>briven does not use it</strong> — briven embeds the DoltGres engine directly
            and provides its own dashboard. listed here only so the ecosystem is clear.
          </li>
        </ul>
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
