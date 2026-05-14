import Link from 'next/link';

export const metadata = {
  title: 'new project',
};

interface SourceCard {
  slug: string;
  name: string;
  blurb: string;
  status: 'auto' | 'concierge';
}

// Picker for the new-project wizard. The "blank" tile is the today-flow
// (a fresh empty postgres schema). Every other tile is a migration
// intake — clicking opens /migrate/<source>, which collects credentials/
// notes and creates a migration_request row. During beta everything is
// concierge-handled; the `status` field flips per-source as adapter
// pipelines ship.
const SOURCES: readonly SourceCard[] = [
  {
    slug: 'convex',
    name: 'convex',
    blurb: 'TS schema + query/mutation/action handlers. document-ish with refs.',
    status: 'concierge',
  },
  {
    slug: 'supabase',
    name: 'supabase',
    blurb: 'postgres under the hood. edge functions + auth + RLS to port.',
    status: 'concierge',
  },
  {
    slug: 'firebase',
    name: 'firebase / firestore',
    blurb: 'document store → relational. the hardest path; we walk you through it.',
    status: 'concierge',
  },
  {
    slug: 'mongodb',
    name: 'mongodb',
    blurb: 'document store. collection shape decisions per table.',
    status: 'concierge',
  },
  {
    slug: 'drizzle',
    name: 'drizzle',
    blurb: 'already postgres + already TS. fastest port.',
    status: 'concierge',
  },
  {
    slug: 'prisma',
    name: 'prisma',
    blurb: 'schema.prisma → briven schema DSL. PrismaClient calls become ctx.db.',
    status: 'concierge',
  },
  {
    slug: 'postgres',
    name: 'raw postgres',
    blurb: 'pg_dump | pg_restore + write your functions in briven.',
    status: 'concierge',
  },
  {
    slug: 'hasura',
    name: 'hasura',
    blurb: 'postgres half ports for free. permission rules become function guards.',
    status: 'concierge',
  },
  {
    slug: 'nextauth',
    name: 'nextauth / auth.js',
    blurb: 'user + session tables map to Better Auth. provider port is trivial.',
    status: 'concierge',
  },
];

export default function NewProjectPickerPage() {
  return (
    <section className="max-w-4xl">
      <header className="mb-8">
        <h1 className="font-mono text-xl tracking-tight">new project</h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          start fresh, or bring your existing project from somewhere else. your source data
          stays untouched until you say cut over.
        </p>
      </header>

      <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
        start fresh
      </h2>
      <Link
        href="/dashboard/projects/new/blank"
        className="mb-10 flex items-start gap-4 rounded-md border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] p-4 transition hover:border-[var(--color-primary)]"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--color-primary)] font-mono text-base text-[var(--color-text-inverse)]">
          +
        </div>
        <div className="flex-1">
          <p className="font-mono text-sm text-[var(--color-text)]">blank project</p>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            empty postgres schema + function runtime. one click, ready in seconds. pick this
            if you&apos;re trying briven for the first time or building from scratch.
          </p>
        </div>
      </Link>

      <h2 className="mb-1 font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
        bring your project
      </h2>
      <p className="mb-4 font-mono text-xs text-[var(--color-text-subtle)]">
        every migration is free during beta — we handle the move for you and you keep
        running on your source until you&apos;re ready to cut over.
      </p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SOURCES.map((s) => (
          <li key={s.slug}>
            <Link
              href={`/dashboard/projects/new/migrate/${s.slug}`}
              className="flex h-full flex-col gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-border-strong)]"
            >
              <div className="flex items-center justify-between">
                <p className="font-mono text-sm text-[var(--color-text)]">{s.name}</p>
                <span className="rounded-full border border-[var(--color-border-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                  {s.status === 'auto' ? 'auto' : 'concierge'}
                </span>
              </div>
              <p className="font-mono text-xs text-[var(--color-text-muted)]">{s.blurb}</p>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-10 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        <strong className="text-[var(--color-text)]">your source stays safe.</strong> nothing
        we do touches the system you&apos;re coming from. we read your data, write a copy into
        briven, and let you parallel-run for as long as you need before you flip writes. you
        can roll back to your source at any point in the first 7 days after cutover.
      </p>
    </section>
  );
}
