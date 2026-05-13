import Link from 'next/link';

import { BackgroundGrid } from './background-grid';
import { CompareTable } from './compare-table';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';
import type { SessionUser } from '../../lib/session';

interface ComparePageProps {
  user: SessionUser | null;
  otherName: string;
  oneline: string;
  intro: string;
  rows: { feature: string; briven: string; other: string; note?: string }[];
  whenOtherWins: string[];
  whenBrivenWins: string[];
  migrationGuideHref?: string;
}

export function ComparePage(props: ComparePageProps) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      <BackgroundGrid />
      <SiteHeader user={props.user} />

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-10 pt-16 sm:pt-20">
        <p className="font-mono uppercase tracking-[0.12em] text-[var(--color-primary)] text-[var(--text-xs)]">
          briven vs {props.otherName}
        </p>
        <h1 className="mt-4 font-sans font-medium leading-[1.05] tracking-[-0.03em] text-[var(--color-text)] text-[var(--text-display-3)] sm:text-[var(--text-display-2)]">
          {props.oneline}
        </h1>
        <p className="mt-6 max-w-2xl leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-body)]">
          {props.intro}
        </p>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-12">
        <CompareTable rows={props.rows} otherName={props.otherName} />
      </section>

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-16">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-border-subtle)] md:grid-cols-2">
          <div className="flex flex-col gap-3 bg-[var(--color-bg)] p-6">
            <h3 className="font-mono text-sm text-[var(--color-text-muted)]">
              when {props.otherName} wins
            </h3>
            <ul className="flex flex-col gap-2 leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
              {props.whenOtherWins.map((point, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-[var(--color-text-subtle)]">·</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-3 bg-[var(--color-bg)] p-6">
            <h3 className="font-mono text-sm text-[var(--color-primary)]">when briven wins</h3>
            <ul className="flex flex-col gap-2 leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
              {props.whenBrivenWins.map((point, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-[var(--color-primary)]">·</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-20">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/signin"
            className="inline-flex h-12 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-6 font-sans font-medium text-[var(--color-text-inverse)] transition-colors hover:bg-[var(--color-primary-hover)]"
          >
            try briven free
          </Link>
          {props.migrationGuideHref ? (
            <Link
              href={props.migrationGuideHref}
              className="inline-flex h-12 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] px-6 font-sans font-medium text-[var(--color-text)] hover:border-[var(--color-border-strong)]"
            >
              migration guide →
            </Link>
          ) : null}
          <Link
            href="/compare"
            className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            ← all comparisons
          </Link>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
