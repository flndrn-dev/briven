import Link from 'next/link';

interface Tier {
  id: 'free' | 'pro' | 'team';
  name: string;
  price: string;
  cadence: string;
  pitch: string;
  features: string[];
  cta: { label: string; href: string };
  highlight: boolean;
}

const TIERS: readonly Tier[] = [
  {
    id: 'free',
    name: 'free',
    price: '$0',
    cadence: '/month',
    pitch: 'for hobby projects + first-deploy on your own stack.',
    features: [
      '1 project',
      'shared postgres schema',
      '50k function invocations / month',
      '1 gb storage',
      '7-day log retention',
      'community support',
    ],
    cta: { label: 'get started', href: '/signin' },
    highlight: false,
  },
  {
    id: 'pro',
    name: 'pro',
    price: '$25',
    cadence: '/month',
    pitch: 'for production apps with real traffic and team of one.',
    features: [
      '10 projects',
      'shared postgres schema',
      '5m function invocations / month',
      '50 gb storage',
      '30-day log retention',
      'email support',
    ],
    cta: { label: 'upgrade to pro', href: '/dashboard/billing/upgrade?tier=pro' },
    highlight: true,
  },
  {
    id: 'team',
    name: 'team',
    price: '$100',
    cadence: '/month',
    pitch: 'for growing teams who want dedicated infrastructure.',
    features: [
      'unlimited projects',
      'dedicated postgres cluster',
      '25m function invocations / month',
      '500 gb storage',
      '90-day log retention',
      'priority support + sla',
    ],
    cta: { label: 'upgrade to team', href: '/dashboard/billing/upgrade?tier=team' },
    highlight: false,
  },
];

export function PricingSection() {
  return (
    <section
      id="pricing"
      className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20 sm:py-24"
    >
      <div className="flex flex-col gap-3 pb-10">
        <h2 className="font-sans text-[var(--text-h1)] font-medium tracking-[-0.02em] text-[var(--color-text)]">
          pricing
        </h2>
        <p className="max-w-2xl font-sans text-[var(--text-body)] leading-[1.6] text-[var(--color-text-muted)]">
          start free, upgrade when you have traffic. cancel any time. your data is
          portable — pg_dump is always your escape hatch.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-border-subtle)] lg:grid-cols-3">
        {TIERS.map((tier) => (
          <TierCard key={tier.id} tier={tier} />
        ))}
      </div>

      <p className="pt-6 font-mono text-[var(--text-xs)] text-[var(--color-text-subtle)]">
        prices in USD · vat added at checkout for EU customers · self-hosting is free forever (agpl-3.0)
      </p>
    </section>
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
        <h3 className="font-mono text-[var(--text-xs)] uppercase tracking-[0.12em] text-[var(--color-primary)]">
          {tier.name}
        </h3>
        {tier.highlight ? (
          <span className="rounded-[var(--radius-full)] bg-[var(--color-primary-subtle)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-primary)]">
            most popular
          </span>
        ) : null}
      </header>

      <div className="flex items-baseline gap-1">
        <span className="font-sans text-[var(--text-display-3)] font-medium tracking-[-0.02em] text-[var(--color-text)]">
          {tier.price}
        </span>
        <span className="font-mono text-[var(--text-small)] text-[var(--color-text-subtle)]">
          {tier.cadence}
        </span>
      </div>

      <p className="font-sans text-[var(--text-small)] leading-[1.6] text-[var(--color-text-muted)]">
        {tier.pitch}
      </p>

      <ul className="flex flex-col gap-2">
        {tier.features.map((feature) => (
          <li
            key={feature}
            className="flex items-start gap-2 font-mono text-[var(--text-xs)] text-[var(--color-text-muted)]"
          >
            <span aria-hidden className="mt-1 inline-block size-1 rounded-full bg-[var(--color-primary)]" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

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
