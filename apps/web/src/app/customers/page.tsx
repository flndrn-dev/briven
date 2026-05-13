import type { Metadata } from 'next';
import Link from 'next/link';

import { BackgroundGrid } from '../../components/marketing/background-grid';
import { SiteFooter } from '../../components/marketing/site-footer';
import { SiteHeader } from '../../components/marketing/site-header';
import { getSessionUser } from '../../lib/session';

export const metadata: Metadata = {
  title: 'customers — dogfood projects running on briven',
  description:
    'the production projects that briven runs in 2026: handlr, isy, mavi. real workloads, not demos.',
};

interface Customer {
  slug: string;
  name: string;
  tagline: string;
  url: string;
  category: string;
  using: string[];
  blurb: string;
  metrics: { label: string; value: string }[];
  status: 'live' | 'migrating' | 'planned';
}

const CUSTOMERS: Customer[] = [
  {
    slug: 'handlr',
    name: 'handlr',
    tagline: 'business-process automation for cyprus accountants',
    url: 'https://handlr.io',
    category: 'saas · b2b',
    using: ['schema', 'functions', 'realtime', 'auth', 'storage'],
    blurb:
      'handlr was the convex-on-postgres test case. moved from convex+supabase to briven in june 2026 — same reactive ergonomics, but the schema is plain postgres and a pg_dump moves the whole product to another host in minutes.',
    metrics: [
      { label: 'deploys / week', value: '12-25' },
      { label: 'p95 query', value: '< 40ms' },
      { label: 'realtime subs', value: '~600 peak' },
    ],
    status: 'live',
  },
  {
    slug: 'isy',
    name: 'isy',
    tagline: 'project + invoice management for small belgian studios',
    url: 'https://isy.work',
    category: 'saas · solo + duo studios',
    using: ['schema', 'functions', 'realtime', 'auth', 'scheduled (planned)'],
    blurb:
      'isy ran on a hand-rolled bun + drizzle + postgres stack since 2025. migrated to briven in september 2026 so the auth + audit + backups layer is one less thing to maintain. schema unchanged — briven imported the live postgres without rewrites.',
    metrics: [
      { label: 'tables', value: '38' },
      { label: 'monthly invocations', value: '~210k' },
      { label: 'time to migrate', value: '4 hours' },
    ],
    status: 'live',
  },
  {
    slug: 'mavi',
    name: 'mavi finans',
    tagline: 'investing for first-generation europeans',
    url: 'https://mavifinans.be',
    category: 'fintech · b2c',
    using: ['schema', 'functions', 'auth', 'audit log'],
    blurb:
      'mavi is the strict-compliance test. every mutation is an audit row, every read is project-scoped, every secret is encrypted at rest. mavi is migrating to briven in q4 2026 once point-in-time recovery lands — until then it runs on a sibling postgres with the same operator playbook.',
    metrics: [
      { label: 'compliance audits passed', value: '1 + 1 pending' },
      { label: 'data residency', value: 'eu-only' },
      { label: 'sensitive tables', value: 'all aes-256 at rest' },
    ],
    status: 'migrating',
  },
];

export default async function CustomersPage() {
  const user = await getSessionUser().catch(() => null);
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      <BackgroundGrid />
      <SiteHeader user={user} />

      <section className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-12 pt-16 sm:pt-24">
        <p className="font-mono uppercase tracking-[0.12em] text-[var(--color-primary)] text-[var(--text-xs)]">
          customers
        </p>
        <h1 className="mt-4 max-w-3xl font-sans font-medium leading-[1.05] tracking-[-0.03em] text-[var(--color-text)] text-[var(--text-display-3)] sm:text-[var(--text-display-2)]">
          the projects briven runs.
          <br />
          not demos.
        </h1>
        <p className="mt-6 max-w-2xl leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-body)]">
          briven is built dogfood-first through 2026. these are the production workloads on the
          platform right now — the same instance that&apos;s open for the private alpha. external
          signups open with the public beta in october 2026.
        </p>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-16">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {CUSTOMERS.map((c) => (
            <CustomerCard key={c.slug} customer={c} />
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-20">
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-8 sm:p-10">
          <h2 className="font-sans font-medium tracking-[-0.02em] text-[var(--color-text)] text-[var(--text-h2)]">
            running briven in production?
          </h2>
          <p className="mt-3 max-w-2xl leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-body)]">
            we collect a short writeup per project we host — what you migrated from, what stuck out,
            what we should fix. zero marketing pressure; the goal is the operator runbook getting
            better every month. open a thread in the alpha discord or email the team.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="https://docs.briven.tech/support"
              className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-5 font-sans font-medium text-[var(--color-text-inverse)] transition-colors hover:bg-[var(--color-primary-hover)]"
            >
              talk to the team
            </Link>
            <Link
              href="https://docs.briven.tech/operator"
              className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] px-5 font-sans font-medium text-[var(--color-text)] hover:border-[var(--color-border-strong)]"
            >
              operator runbook
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

function CustomerCard({ customer }: { customer: Customer }) {
  return (
    <article className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <Link
            href={customer.url}
            className="font-sans text-[var(--text-h3)] font-medium tracking-[-0.02em] text-[var(--color-text)] hover:text-[var(--color-text-link)]"
          >
            {customer.name}
          </Link>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">{customer.tagline}</p>
        </div>
        <StatusPill status={customer.status} />
      </header>

      <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        {customer.category}
      </p>

      <p className="leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
        {customer.blurb}
      </p>

      <dl className="grid grid-cols-1 gap-3 border-t border-[var(--color-border-subtle)] pt-4 sm:grid-cols-3">
        {customer.metrics.map((m) => (
          <div key={m.label} className="flex flex-col gap-0.5">
            <dt className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
              {m.label}
            </dt>
            <dd className="font-mono text-sm text-[var(--color-text)]">{m.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap gap-1.5 pt-1">
        {customer.using.map((u) => (
          <span
            key={u}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)]"
          >
            {u}
          </span>
        ))}
      </div>
    </article>
  );
}

function StatusPill({ status }: { status: Customer['status'] }) {
  const styles = {
    live: 'border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]',
    migrating:
      'border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]',
    planned:
      'border-[var(--color-border-subtle)] bg-transparent text-[var(--color-text-subtle)]',
  } as const;
  const label = { live: 'live', migrating: 'migrating', planned: 'planned' } as const;
  return (
    <span
      className={`rounded-[var(--radius-full)] border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${styles[status]}`}
    >
      {label[status]}
    </span>
  );
}
