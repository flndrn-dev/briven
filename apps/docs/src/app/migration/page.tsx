import { DocsShell } from '../../components/shell';

export const metadata = {
  title: 'migration',
};

export default function MigrationPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">migration</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        moving from convex, supabase, raw postgres, prisma, drizzle, or firebase to briven.
      </p>

      <div className="mt-6 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        every sentence on this page is proven by a real migration. the per-source detail (§{' '}
        <em>convex</em>, § <em>supabase</em>, …) lands incrementally as each first migration
        clears. if a step on your source isn&apos;t covered yet, ping us — the missing part is
        a known gap, not a deliberate omission.
      </div>

      <h2 className="mt-12 font-mono text-xl tracking-tight">five principles</h2>
      <ol className="mt-4 flex flex-col gap-3 font-mono text-sm text-[var(--color-text-muted)]">
        <Principle n={1} title="read before write">
          read this entire page once before running any command. migrations that go sideways
          almost always do so because someone skipped this step.
        </Principle>
        <Principle n={2} title="parallel-run, don't switch">
          for at least 48 hours, the old system and briven run side-by-side, on the same
          data, serving the same traffic. no cutover before the parallel-run window.
        </Principle>
        <Principle n={3} title="back up twice">
          two independent backups to two independent destinations before you touch anything.
          verify both before proceeding.
        </Principle>
        <Principle n={4} title="schema first, data second, functions third, traffic last">
          in that order, always. inverting the order leaves windows where something is
          half-migrated and a write goes to the wrong place.
        </Principle>
        <Principle n={5} title="one product at a time">
          never migrate two things in parallel. the cognitive load of one migration is enough.
        </Principle>
      </ol>

      <h2 className="mt-12 font-mono text-xl tracking-tight">the ten-step playbook</h2>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        every migration follows these ten steps in order. specific commands vary per source —
        per-source detail pages cover those.
      </p>
      <ol className="mt-6 flex flex-col gap-4 font-mono text-sm text-[var(--color-text-muted)]">
        <Step
          n={1}
          title="inventory the source"
          body="list every table, view, function, trigger, extension, env var, and external service the source project depends on. count rows per table. document the auth model in plain language. write it all into a migration-inventory.md so later steps don't surprise you."
        />
        <Step
          n={2}
          title="set up the briven project"
          body="install @briven/cli, briven login, briven init, create the project in the dashboard, note the project id and the admin api key. configure the region closest to your users."
        />
        <Step
          n={3}
          title="back up the source twice"
          body="non-negotiable. two backups, two destinations, both restored to a temp database and row-counted to verify. don't proceed to step 4 until both verify."
        />
        <Step
          n={4}
          title="port the schema"
          body="translate the source schema into briven/schema.ts using the briven schema dsl. table-by-table — don't try to do it in one pass. preserve foreign-key relationships and indexes."
        />
        <Step
          n={5}
          title="port the functions"
          body="every server-side function (convex query/mutation, supabase edge function, prisma RPC) becomes a file under briven/functions/. wrap each with query() or mutation() from @briven/cli/server."
        />
        <Step
          n={6}
          title="set up env vars"
          body="briven env set <key> <value> for every secret the source project uses. encrypted at rest with the platform key. the runtime injects them into ctx.env at cold start."
        />
        <Step
          n={7}
          title="copy the data"
          body="pg_dump from the source, pg_restore into the briven data plane via the project's dsn (briven db shell-token issues a short-lived dsn). row-count every table — it must match step 1."
        />
        <Step
          n={8}
          title="parallel-run for 48 hours"
          body="point a fraction of read traffic at briven, keep writes on the source. observe error rates, p50/p99 latency, and any function failures. divergence here is the time to surface migration bugs — not after the cutover."
        />
        <Step
          n={9}
          title="cut over writes"
          body="flip the dns or the client config. writes now go to briven; the source becomes read-only. keep the source running for at least another 7 days as a rollback target."
        />
        <Step
          n={10}
          title="decommission"
          body="after 7 days of green metrics, archive the source database to cold storage and tear down the running source. keep the archive for 90 days minimum."
        />
      </ol>

      <h2 className="mt-12 font-mono text-xl tracking-tight">per-source guides</h2>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        each source has its own path through the ten steps. these expand as the first
        migration of each kind clears.
      </p>
      <ul className="mt-6 flex flex-col gap-2 font-mono text-sm">
        <SourceItem
          name="convex"
          status="documented"
          href="/migration/convex"
          summary="union-of-literal fields → text() with app-level validation; v.id() → text().references(); _creationTime → explicit created_at."
        />
        <SourceItem
          name="supabase"
          status="documented"
          href="/migration/supabase"
          summary="row-level-security policies don't carry over — express them as guards in function code. edge functions port 1:1; storage cps to MinIO."
        />
        <SourceItem
          name="raw postgres"
          status="documented · straightest path"
          href="/migration/postgres"
          summary="schema.sql → briven/schema.ts via the dsl, pg_dump | pg_restore against the briven dsn, port handlers into briven/functions/."
        />
        <SourceItem
          name="drizzle"
          status="documented"
          href="/migration/drizzle"
          summary="schema.ts ports almost 1:1 (drizzle and briven both target postgres with TS-first schema definitions). swap the imports + adapt the column-builder calls; data carries via pg_dump."
        />
        <SourceItem
          name="prisma"
          status="documented"
          href="/migration/prisma"
          summary="schema.prisma → briven/schema.ts via the dsl (we map the field decorators to briven helpers); pg_dump | pg_restore for data; PrismaClient calls become ctx.db chains."
        />
        <SourceItem
          name="firebase / firestore"
          status="documented · hardest path"
          href="/migration/firebase"
          summary="document model → relational model is a manual remap. plan for an extended parallel-run window (2+ weeks) to catch shape mismatches."
        />
        <SourceItem
          name="hasura"
          status="documented"
          href="/migration/hasura"
          summary="postgres half ports for free; the work is the permissions port — every (role, table, action) triple from hasura metadata becomes a guard in function code."
        />
        <SourceItem
          name="nextauth / auth.js"
          status="documented"
          href="/migration/nextauth"
          summary="schema maps 1:1 (both target Better Auth's shape); provider port is trivial; the work is replacing getServerSession + useSession callsites and choosing preserve-ids vs preserve-sessions cutover."
        />
      </ul>

      <h2 className="mt-12 font-mono text-xl tracking-tight">when not to use this</h2>
      <ul className="mt-4 list-inside list-disc font-mono text-sm text-[var(--color-text-muted)]">
        <li>moving between briven projects — wait for briven export / import (private beta)</li>
        <li>moving a briven project between regions — file a support ticket</li>
        <li>migrating only data without schema changes — use pg_dump / pg_restore directly</li>
      </ul>
    </DocsShell>
  );
}

function Principle({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] text-xs">
        {n}
      </span>
      <div>
        <p className="font-mono text-[var(--color-text)]">{title}</p>
        <p className="mt-1">{children}</p>
      </div>
    </li>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-text-inverse)]">
        {n}
      </span>
      <div>
        <p className="font-mono text-[var(--color-text)]">{title}</p>
        <p className="mt-1">{body}</p>
      </div>
    </li>
  );
}

function SourceItem({
  name,
  status,
  summary,
  href,
}: {
  name: string;
  status: string;
  summary: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="font-mono text-[var(--color-text)]">{name}</p>
      <p className="mt-1 font-mono text-xs text-[var(--color-text-subtle)]">{status}</p>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">{summary}</p>
    </>
  );
  if (href) {
    return (
      <li>
        <a
          href={href}
          className="block rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-border)]"
        >
          {body}
        </a>
      </li>
    );
  }
  return (
    <li className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      {body}
    </li>
  );
}
