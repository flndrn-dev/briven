import type { Metadata } from 'next';
import Link from 'next/link';

import { BackgroundGrid } from '../../components/marketing/background-grid';
import { SiteFooter } from '../../components/marketing/site-footer';
import { SiteHeader } from '../../components/marketing/site-header';
import { getSessionUser } from '../../lib/session';

export const metadata: Metadata = {
  title: 'compare — briven vs convex, supabase, firebase',
  description:
    'feature-by-feature comparison: briven vs convex, supabase, firebase. honest tradeoffs, not marketing.',
};

interface Comparison {
  slug: string;
  name: string;
  oneline: string;
  blurb: string;
}

const COMPARISONS: Comparison[] = [
  {
    slug: 'convex',
    name: 'convex',
    oneline: 'reactive backend with a closed proprietary database',
    blurb:
      'convex pioneered the reactive-queries pattern briven adopts. the difference is the floor: convex stores your data in its own engine; briven stores it in plain postgres, which means pg_dump moves your whole product anywhere.',
  },
  {
    slug: 'supabase',
    name: 'supabase',
    oneline: 'postgres + auth + storage + row-level security',
    blurb:
      'both are postgres-first. supabase exposes the database directly through postgrest + row-level security; briven puts a typed function layer in front and adds convex-style reactive subscriptions that supabase doesn&apos;t have.',
  },
  {
    slug: 'firebase',
    name: 'firebase',
    oneline: 'document store with client-side security rules',
    blurb:
      'firebase is nosql with realtime built-in; briven is real sql on postgres with realtime built-in. firebase rules run on the client query; briven runs typed functions on the server with project-scoped connections.',
  },
];

export default async function CompareHubPage() {
  const user = await getSessionUser().catch(() => null);
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      <BackgroundGrid />
      <SiteHeader user={user} />

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-12 pt-16 sm:pt-24">
        <p className="font-mono uppercase tracking-[0.12em] text-[var(--color-primary)] text-[var(--text-xs)]">
          compare
        </p>
        <h1 className="mt-4 font-sans font-medium leading-[1.05] tracking-[-0.03em] text-[var(--color-text)] text-[var(--text-display-3)] sm:text-[var(--text-display-2)]">
          briven against the field.
        </h1>
        <p className="mt-6 max-w-2xl leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-body)]">
          honest comparisons against the platforms briven is most often weighed against. every row
          is a real difference — not a checkbox we invented to favour ourselves. where the other
          platform wins, we say so.
        </p>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-20">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {COMPARISONS.map((c) => (
            <Link
              key={c.slug}
              href={`/compare/${c.slug}`}
              className="group flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 transition hover:border-[var(--color-border-strong)]"
            >
              <p className="font-mono uppercase tracking-[0.12em] text-[var(--color-text-subtle)] text-[var(--text-xs)]">
                vs
              </p>
              <h2 className="font-sans font-medium tracking-[-0.02em] text-[var(--color-text)] text-[var(--text-h3)]">
                {c.name}
              </h2>
              <p className="font-mono text-xs text-[var(--color-text-muted)]">{c.oneline}</p>
              <p className="mt-2 leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
                {c.blurb}
              </p>
              <span className="mt-auto font-mono text-xs text-[var(--color-text-link)] group-hover:underline">
                read the comparison →
              </span>
            </Link>
          ))}
        </div>

        <p className="mt-10 font-mono text-xs text-[var(--color-text-subtle)]">
          missing a comparison you want? open an issue on the repo or ask in the alpha discord. we
          add a comparison page when at least three operators ask the same migration question.
        </p>
      </section>

      <SiteFooter />
    </main>
  );
}
