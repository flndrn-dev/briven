import Link from 'next/link';

interface Tier {
  id: 'free' | 'pro' | 'team';
  name: string;
  price: string;
  cadence: string;
  pitch: string;
  included: readonly { label: string; value: string }[];
  overage: readonly { label: string; value: string }[];
  features: readonly string[];
  cta: { label: string; href: string };
  highlight: boolean;
  note?: string;
}

/**
 * Pricing copy for briven.tech.
 *
 * Model: PREPAID, never metered. Each tier has hard caps at the included
 * limits; hit a limit and we ask you to upgrade — we never bill beyond what
 * you've loaded (no surprise bills). Paid top-ups run through mavi-pay.
 * Limits are tuned to beat Neon/Supabase on room-per-euro (see pricing research
 * 2026-06-15): Briven free = 1 GB + never pauses (Supabase free pauses at 1 wk,
 * gives 500 MB); Briven Pro = 100 GB db vs Supabase Pro 8 GB; Team $99.99 vs $599.
 */
// NOTE: tier prices (€0/29/99) approved by Jürgen 2026-06-15; limits competitor-
// tuned. Paid billing activates when mavi-pay ships (parked until then).
const TIERS: readonly Tier[] = [
  {
    id: 'free',
    name: 'free',
    price: '$0',
    cadence: '/month',
    pitch: 'real projects, no credit card, never pauses. perfect for trying briven or a small database.',
    included: [
      { label: 'projects', value: '3' },
      { label: 'database size', value: '1 gb' },
      { label: 'file storage', value: '1 gb' },
      { label: 'history / undo', value: '7 days' },
      { label: 'logins / users', value: '50,000' },
      { label: 'live updates', value: '10 at once' },
    ],
    overage: [],
    features: [
      'no credit card needed',
      'never pauses (unlike the big names)',
      'community support (discord, github)',
    ],
    cta: { label: 'get started free', href: '/signin' },
    highlight: false,
  },
  {
    id: 'pro',
    name: 'pro',
    price: '$29.99',
    cadence: '/month',
    pitch: 'growing apps. 100 gb database — over 12× what Supabase Pro gives you.',
    included: [
      { label: 'projects', value: '20' },
      { label: 'database size', value: '100 gb' },
      { label: 'file storage', value: '150 gb' },
      { label: 'history / undo', value: '30 days' },
      { label: 'logins / users', value: '100,000' },
      { label: 'live updates', value: '100 at once' },
    ],
    overage: [],
    features: [
      'point-and-click + spreadsheet editing',
      'custom domains per project',
      'daily backups (30-day history)',
      'email support (48h)',
    ],
    cta: { label: 'upgrade to pro', href: '/dashboard/billing/upgrade?tier=pro' },
    highlight: true,
  },
  {
    id: 'team',
    name: 'team',
    price: '$99.99',
    cadence: '/month',
    pitch: 'teams + bigger workloads. $99.99 where Supabase charges $599 for their team plan.',
    included: [
      { label: 'projects', value: 'unlimited' },
      { label: 'database size', value: '500 gb' },
      { label: 'file storage', value: '500 gb' },
      { label: 'history / undo', value: '1 year' },
      { label: 'logins / users', value: 'unlimited' },
      { label: 'live updates', value: '500 at once' },
    ],
    overage: [],
    features: [
      '5 team seats included',
      'hourly backups',
      'priority support',
      'audit log',
    ],
    cta: { label: 'upgrade to team', href: '/dashboard/billing/upgrade?tier=team' },
    highlight: false,
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
      <div className="flex flex-col gap-3 pb-10">
        <h2 className="font-sans font-medium tracking-[-0.02em] text-[var(--color-text)] text-[var(--text-h1)]">
          pricing
        </h2>
        <p className="max-w-2xl font-sans leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-body)]">
          simple, honest pricing — far more room than Neon or Supabase, at a fraction of the price.
          the free tier needs no card and never pauses. paid plans are prepaid — you load credit and
          only spend what you put in, so there are no surprise bills. cancel any time, and export
          your data whenever you like — it&apos;s your database.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-border-subtle)] lg:grid-cols-3">
        {TIERS.map((tier) => (
          <TierCard key={tier.id} tier={tier} />
        ))}
      </div>

      <div className="flex flex-col gap-1 pt-6 font-mono text-[var(--color-text-subtle)] text-[var(--text-xs)]">
        <p>
          prices in USD · VAT / sales tax is calculated and added at checkout based on your country
          (reverse-charge for valid EU VAT ids) ·
          free tier needs no card · paid is prepaid — no surprise bills
        </p>
        <p>
          self-hosting is free forever under agpl-3.0 · hit a plan limit and we ask you to upgrade —
          we never bill you beyond what you&apos;ve loaded
        </p>
      </div>

      <SelfHostCommercialBand />
    </section>
  );
}

interface CommercialTier {
  name: string;
  price: string;
  cadence: string;
  who: string;
  bullets: readonly string[];
}

const COMMERCIAL_TIERS: readonly CommercialTier[] = [
  {
    name: 'startup',
    price: '€400',
    cadence: '/month',
    who: 'early-stage companies past the agpl-acceptable threshold',
    bullets: [
      'commercial licence for one production deployment',
      'up to €5M ARR',
      'community + email support',
    ],
  },
  {
    name: 'business',
    price: '€2,000',
    cadence: '/month',
    who: 'scale-ups, agencies, multi-product orgs',
    bullets: [
      'up to 10 production deployments',
      'up to €25M ARR',
      'email support, 5×8 response SLA',
    ],
  },
  {
    name: 'enterprise',
    price: 'from €8,000',
    cadence: '/month',
    who: 'regulated industries, large internal IT',
    bullets: [
      'unlimited deployments',
      'custom SLA + dedicated account',
      'optional source escrow, priority security patches',
    ],
  },
];

function SelfHostCommercialBand() {
  return (
    <section
      id="self-host-commercial"
      className="mt-16 flex flex-col gap-6 border-t border-[var(--color-border-subtle)] pt-12"
    >
      <div className="flex flex-col gap-4">
        <p className="font-mono uppercase tracking-[0.12em] text-[var(--color-primary)] text-[var(--text-xs)]">
          self-host commercial
        </p>
        <h2 className="font-sans font-medium tracking-[-0.02em] text-[var(--color-text)] text-[var(--text-h2)]">
          run briven on your own hardware.
        </h2>
        <p className="max-w-2xl font-sans leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-body)]">
          briven-core ships under <strong>agpl-3.0</strong> and is free to run, modify, and
          self-host forever. the commercial licence is the alternative for companies that need to
          embed briven in a product without releasing their source, run it as a hosted service for
          third parties, or operate it inside a legal entity over <strong>€10M ARR</strong> or{' '}
          <strong>100 FTEs</strong>. see the{' '}
          <Link
            href="https://docs.briven.tech/trust"
            className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
          >
            trust page
          </Link>{' '}
          for full terms.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-border-subtle)] lg:grid-cols-3">
        {COMMERCIAL_TIERS.map((tier) => (
          <CommercialTierCard key={tier.name} tier={tier} />
        ))}
      </div>

      <div className="flex flex-col gap-1 font-mono text-[var(--color-text-subtle)] text-[var(--text-xs)]">
        <p>
          all commercial tiers billed annually in advance · prices in EUR exclusive of VAT · the
          agpl-3.0 release stays free regardless of the commercial tier table
        </p>
        <p>
          source available at{' '}
          <Link
            href="https://github.com/flndrn-dev/briven"
            className="hover:text-[var(--color-text-muted)]"
          >
            github.com/flndrn-dev/briven
          </Link>{' '}
          · sla details at{' '}
          <Link
            href="https://docs.briven.tech/sla"
            className="hover:text-[var(--color-text-muted)]"
          >
            docs.briven.tech/sla
          </Link>
        </p>
      </div>
    </section>
  );
}

function CommercialTierCard({ tier }: { tier: CommercialTier }) {
  return (
    <article className="flex flex-col gap-5 bg-[var(--color-bg)] p-8">
      <header>
        <h3 className="font-mono uppercase tracking-[0.12em] text-[var(--color-primary)] text-[var(--text-xs)]">
          {tier.name}
        </h3>
      </header>

      <div className="flex items-baseline gap-1">
        <span className="font-sans font-medium tracking-[-0.02em] text-[var(--color-text)] text-[var(--text-display-3)]">
          {tier.price}
        </span>
        <span className="font-mono text-[var(--color-text-subtle)] text-[var(--text-small)]">
          {tier.cadence}
        </span>
      </div>

      <p className="font-sans leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
        {tier.who}
      </p>

      <ul className="flex flex-col gap-2 border-t border-[var(--color-border-subtle)] pt-5">
        {tier.bullets.map((b) => (
          <li
            key={b}
            className="flex items-start gap-2 font-mono text-[var(--color-text-muted)] text-[var(--text-xs)]"
          >
            <span
              aria-hidden
              className="mt-1 inline-block size-1 rounded-full bg-[var(--color-primary)]"
            />
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <Link
        href="/contact?topic=legal"
        className="mt-auto inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 font-sans font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)]"
      >
        contact licensing
      </Link>
    </article>
  );
}

function TierCard({ tier }: { tier: Tier }) {
  return (
    <article
      className={`flex flex-col gap-5 bg-[var(--color-bg)] p-8 ${
        tier.highlight ? 'ring-1 ring-inset ring-[var(--color-border-primary)]' : ''
      }`}
    >
      <header className="flex items-baseline justify-between">
        <h3 className="font-mono uppercase tracking-[0.12em] text-[var(--color-primary)] text-[var(--text-xs)]">
          {tier.name}
        </h3>
        {tier.highlight ? (
          <span className="rounded-[var(--radius-full)] bg-[var(--color-primary-subtle)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-primary)]">
            most popular
          </span>
        ) : null}
      </header>

      <div className="flex items-baseline gap-1">
        <span className="font-sans font-medium tracking-[-0.02em] text-[var(--color-text)] text-[var(--text-display-3)]">
          {tier.price}
        </span>
        <span className="font-mono text-[var(--color-text-subtle)] text-[var(--text-small)]">
          {tier.cadence}
        </span>
      </div>

      <p className="font-sans leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
        {tier.pitch}
      </p>

      <div className="flex flex-col gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-text-subtle)]">
          included each month
        </p>
        <dl className="grid grid-cols-1 gap-1.5 font-mono text-[var(--text-xs)]">
          {tier.included.map((row) => (
            <div key={row.label} className="flex justify-between gap-3">
              <dt className="text-[var(--color-text-muted)]">{row.label}</dt>
              <dd className="whitespace-nowrap text-right text-[var(--color-text)]">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {tier.overage.length > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-text-subtle)]">
            past the bucket
          </p>
          <dl className="grid grid-cols-1 gap-1.5 font-mono text-[var(--text-xs)]">
            {tier.overage.map((row) => (
              <div key={row.label} className="flex justify-between gap-3">
                <dt className="text-[var(--color-text-subtle)]">{row.label}</dt>
                <dd className="whitespace-nowrap text-right text-[var(--color-text-muted)]">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {tier.features.length > 0 ? (
        <ul className="flex flex-col gap-2 border-t border-[var(--color-border-subtle)] pt-5">
          {tier.features.map((feature) => (
            <li
              key={feature}
              className="flex items-start gap-2 font-mono text-[var(--color-text-muted)] text-[var(--text-xs)]"
            >
              <span
                aria-hidden
                className="mt-1 inline-block size-1 rounded-full bg-[var(--color-primary)]"
              />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <Link
        href={tier.cta.href}
        className={
          tier.highlight
            ? 'mt-auto inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 font-sans font-medium text-[var(--color-text-inverse)] shadow-[var(--shadow-sm)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-briven)] hover:bg-[var(--color-primary-hover)]'
            : 'mt-auto inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-4 font-sans font-medium text-[var(--color-text)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-briven)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)]'
        }
      >
        {tier.cta.label}
      </Link>
    </article>
  );
}
