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
 * Model: every tier includes a monthly allowance, then meters beyond it.
 * Phase 2/3 enforces hard caps at the included limits; Phase 4 (public beta)
 * turns the overage rates into live pay-per-use billing via Polar meters.
 * Copy reflects the Phase 4 target so customers understand the direction.
 */
const TIERS: readonly Tier[] = [
  {
    id: 'free',
    name: 'free',
    price: '€0',
    cadence: '/month',
    pitch: 'real projects with no commitment. card required; first euro of usage is on us.',
    included: [
      { label: 'projects', value: 'unlimited' },
      { label: 'function invocations', value: '1M / mo' },
      { label: 'database', value: '1 gb' },
      { label: 'file storage', value: '1 gb' },
      { label: 'bandwidth', value: '10 gb / mo' },
      { label: 'realtime connections', value: '100 concurrent' },
      { label: 'log retention', value: '7 days' },
    ],
    overage: [
      { label: '+1m invocations', value: '€0.30' },
      { label: '+1 gb database', value: '€1.50 / mo' },
      { label: '+1 gb file storage', value: '€0.05 / mo' },
      { label: '+1 gb bandwidth', value: '€0.05' },
    ],
    features: ['community support (discord, github)'],
    cta: { label: 'get started', href: '/signin' },
    highlight: false,
  },
  {
    id: 'pro',
    name: 'pro',
    price: '€29',
    cadence: '/month',
    pitch: 'production apps with real traffic. bigger bucket + cheaper overage + the dev tools.',
    included: [
      { label: 'projects', value: 'unlimited' },
      { label: 'function invocations', value: '10M / mo' },
      { label: 'database', value: '10 gb' },
      { label: 'file storage', value: '50 gb' },
      { label: 'bandwidth', value: '100 gb / mo' },
      { label: 'realtime connections', value: '1,000 concurrent' },
      { label: 'log retention', value: '30 days' },
    ],
    overage: [
      { label: '+1m invocations', value: '€0.20' },
      { label: '+1 gb database', value: '€1.00 / mo' },
      { label: '+1 gb file storage', value: '€0.04 / mo' },
      { label: '+1 gb bandwidth', value: '€0.04' },
    ],
    features: [
      '`briven db shell` + data browser (write)',
      'custom domains per project',
      'daily backups, 7-day retention',
      'email support (48h response)',
    ],
    cta: { label: 'upgrade to pro', href: '/dashboard/billing/upgrade?tier=pro' },
    highlight: true,
  },
  {
    id: 'team',
    name: 'team',
    price: '€99',
    cadence: '/month',
    pitch: 'growing teams that need dedicated infrastructure and audited access.',
    included: [
      { label: 'projects', value: 'unlimited' },
      { label: 'function invocations', value: '100M / mo' },
      { label: 'database', value: '100 gb' },
      { label: 'file storage', value: '500 gb' },
      { label: 'bandwidth', value: '1 tb / mo' },
      { label: 'realtime connections', value: '10,000 concurrent' },
      { label: 'log retention', value: '90 days' },
    ],
    overage: [
      { label: '+1m invocations', value: '€0.15' },
      { label: '+1 gb database', value: '€0.50 / mo' },
      { label: '+1 gb file storage', value: '€0.03 / mo' },
      { label: '+1 gb bandwidth', value: '€0.03' },
    ],
    features: [
      '5 team seats included (+€15 / seat)',
      'dedicated postgres cluster (+€49 / mo)',
      'audit log UI',
      'hourly backups, 30-day retention',
      'priority support, 99.5% SLA',
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
          every tier includes a monthly bucket of invocations, storage, bandwidth, and realtime
          connections. go past the bucket and the meter runs — no surprise-upgrade walls. cancel any
          time. pg_dump is always your escape hatch.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-border-subtle)] lg:grid-cols-3">
        {TIERS.map((tier) => (
          <TierCard key={tier.id} tier={tier} />
        ))}
      </div>

      <div className="flex flex-col gap-1 pt-6 font-mono text-[var(--color-text-subtle)] text-[var(--text-xs)]">
        <p>
          prices in EUR · vat added at checkout for EU customers (reverse-charge for valid vat id) ·
          card required on every tier including free
        </p>
        <p>
          self-hosting is free forever under agpl-3.0 · overage metering launches with public beta;
          private beta uses hard caps at the included limits
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
            href="https://code.konnos.org/flndrn/briven"
            className="hover:text-[var(--color-text-muted)]"
          >
            code.konnos.org/flndrn/briven
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

      <a
        href="mailto:licensing@briven.tech?subject=commercial%20licence%20enquiry"
        className="mt-auto inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 font-sans font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)]"
      >
        contact licensing
      </a>
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
