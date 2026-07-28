import type { Metadata } from 'next';
import Link from 'next/link';

import { BackgroundGrid } from '../../components/marketing/background-grid';
import { MigrationLeadForm } from '../../components/marketing/migration-lead-form';
import { SiteFooter } from '../../components/marketing/site-footer';
import { SiteHeader } from '../../components/marketing/site-header';
import { TrackPageView } from '../../components/marketing/track-page-view';
import { getSessionUser } from '../../lib/session';

export const metadata: Metadata = {
  title: 'migrate to briven — convex, supabase, firebase, prisma, drizzle',
  description:
    'We move your project to Briven for you. Migration help is available for operators. Your current platform stays untouched until you cut over.',
};

interface SourceCard {
  slug: string;
  name: string;
  oneliner: string;
}

// Mirrors the in-dashboard wizard picker (apps/web/.../projects/new/page.tsx).
// Keep the two lists in sync — a source that exists here but not there
// (or vice versa) leaves the customer with a broken click-through.
const SOURCES: readonly SourceCard[] = [
  {
    slug: 'convex',
    name: 'convex',
    oneliner: 'your TS schema + handlers port to briven; useQuery stays the same.',
  },
  {
    slug: 'supabase',
    name: 'supabase',
    oneliner: 'postgres → postgres via pg_dump. edge functions port directly.',
  },
  {
    slug: 'firebase',
    name: 'firebase / firestore',
    oneliner: 'document → relational with shape decisions you approve per collection.',
  },
  {
    slug: 'mongodb',
    name: 'mongodb',
    oneliner: 'flatten vs jsonb per field, streaming COPY into postgres.',
  },
  {
    slug: 'drizzle',
    name: 'drizzle',
    oneliner: 'lightest path — both ends are postgres with a TS schema.',
  },
  {
    slug: 'prisma',
    name: 'prisma',
    oneliner: 'schema.prisma → briven DSL. PrismaClient → ctx.db chains.',
  },
  {
    slug: 'postgres',
    name: 'raw postgres',
    oneliner: 'straightest path — pg_dump | pg_restore + briven for the function layer.',
  },
  {
    slug: 'hasura',
    name: 'hasura',
    oneliner: 'postgres half is free. permission rules become function guards.',
  },
  {
    slug: 'nextauth',
    name: 'nextauth / auth.js',
    oneliner: 'schema maps 1:1 to Better Auth. preserve session IDs or fresh sign-in.',
  },
];

const PROMISES: readonly { title: string; body: string }[] = [
  {
    title: 'your source stays untouched',
    body: 'we only read from your current platform. nothing is moved or deleted until you press the cutover button — which we won’t do until you say so.',
  },
  {
    title: 'parallel-run for as long as you need',
    body: 'reads land on briven, writes stay on your source, until the numbers match. cutover is a button. 7-day rollback if you change your mind.',
  },
  {
    title: 'we do the move, you review',
    body: 'an operator pulls your schema, ports your handlers, and copies your data. you review every step in the dashboard before anything goes live.',
  },
  {
    title: 'migration help available',
    body: 'we’re not charging for migration help in the launch window. Concierge moves may be scheduled with the team; the dashboard wizard stays free to start.',
  },
];

export default async function MigratePage() {
  const user = await getSessionUser().catch(() => null);
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      <TrackPageView
        apiOrigin={process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? ''}
        source="hub"
      />
      <BackgroundGrid />
      <SiteHeader user={user} />

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-12 pt-16 sm:pt-24">
        <p className="font-mono uppercase tracking-[0.12em] text-[var(--color-primary)] text-[var(--text-xs)]">
          migrate
        </p>
        <h1 className="mt-4 font-sans font-medium leading-[1.05] tracking-[-0.03em] text-[var(--color-text)] text-[var(--text-display-3)] sm:text-[var(--text-display-2)]">
          bring your project to briven.
        </h1>
        <p className="mt-6 max-w-2xl leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-body)]">
          we move convex, supabase, firebase, mongodb, drizzle, prisma, raw postgres, hasura
          and nextauth projects to briven for you. with operator help. your current
          platform keeps running the entire time — nothing is moved, deleted, or modified
          until you press cutover.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href={user ? '/dashboard/projects/new' : '/signin?next=/dashboard/projects/new'}
            className="inline-flex h-12 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-6 font-sans font-medium text-[var(--color-text-inverse)] shadow-[var(--shadow-sm)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-briven)] hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-pressed)]"
          >
            start a migration
          </Link>
          <a
            href="mailto:migrations@flndrn.com"
            className="inline-flex h-12 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-6 font-sans font-medium text-[var(--color-text)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-briven)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)]"
          >
            email a human first
          </a>
        </div>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-16">
        <h2 className="font-mono uppercase tracking-[0.12em] text-[var(--color-text-subtle)] text-[var(--text-xs)]">
          what we promise
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {PROMISES.map((p) => (
            <div
              key={p.title}
              className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5"
            >
              <p className="font-mono text-sm text-[var(--color-text)]">{p.title}</p>
              <p className="leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-20">
        <h2 className="font-mono uppercase tracking-[0.12em] text-[var(--color-text-subtle)] text-[var(--text-xs)]">
          where are you coming from?
        </h2>
        <p className="mt-2 leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
          pick your current platform for a detailed look at how the move works — what comes
          for free, what we automate, what stays manual. start the migration from there.
        </p>
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SOURCES.map((s) => (
            <li key={s.slug}>
              <Link
                href={`/migrate/${s.slug}`}
                className="group flex h-full flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5 transition hover:border-[var(--color-border-strong)]"
              >
                <p className="font-sans font-medium tracking-[-0.02em] text-[var(--color-text)] text-[var(--text-h4)]">
                  {s.name}
                </p>
                <p className="leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
                  {s.oneliner}
                </p>
                <span className="mt-auto font-mono text-xs text-[var(--color-text-link)] group-hover:underline">
                  read the {s.name} guide →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-16">
        <h2 className="font-mono uppercase tracking-[0.12em] text-[var(--color-text-subtle)] text-[var(--text-xs)]">
          ready when you are
        </h2>
        <p className="mt-2 leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
          leave us your email and a couple of words about your project. no signup
          required. you&apos;ll hear from us within one business day with the next steps.
        </p>
        <div className="mt-6">
          <MigrationLeadForm
            apiOrigin={process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? ''}
            sources={SOURCES}
          />
        </div>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-24">
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] p-6">
          <h2 className="font-sans font-medium tracking-[-0.02em] text-[var(--color-text)] text-[var(--text-h3)]">
            don&apos;t see your platform?
          </h2>
          <p className="mt-3 leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-body)]">
            we still do it. email{' '}
            <a
              href="mailto:migrations@flndrn.com"
              className="text-[var(--color-text-link)] underline underline-offset-2"
            >
              migrations@flndrn.com
            </a>{' '}
            with a one-paragraph description of where your project lives today and we&apos;ll
            scope a migration for you. supabase / firebase / mongodb / hasura /
            nextauth / drizzle / prisma / convex / raw postgres covered; everything else
            we&apos;ll quote.
          </p>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
