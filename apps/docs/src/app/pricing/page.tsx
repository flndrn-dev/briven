import Link from 'next/link';

import { DocsShell } from '../../components/shell';

export const metadata = { title: 'pricing' };

interface PlanRow {
  label: string;
  free: string;
  pro: string;
  team: string;
}

// Caps are the single source of truth from apps/api/src/services/tiers.ts
// (TIERS). Keep this table in sync with that file if the limits move.
const CAPS: readonly PlanRow[] = [
  { label: 'price', free: '$0', pro: '$29.99 / mo', team: '$99.99 / mo' },
  { label: 'projects per org', free: '3', pro: '20', team: '100' },
  { label: 'functions per project', free: '20', pro: '200', team: '2,000' },
  {
    label: 'function invocations / month',
    free: '100,000',
    pro: '1,000,000',
    team: '10,000,000',
  },
  { label: 'database storage', free: '1 GB', pro: '100 GB', team: '500 GB' },
  {
    label: 'realtime connection-seconds / month',
    free: '1,000,000 (~12 days)',
    pro: '10,000,000 (~115 days)',
    team: '100,000,000 (~1,158 days)',
  },
  {
    label: 'concurrent realtime subscriptions',
    free: '100',
    pro: '1,000',
    team: '10,000',
  },
  {
    label: 'auth monthly active users',
    free: '1,000',
    pro: '25,000',
    team: '250,000',
  },
  {
    label: 'support',
    free: 'community (github)',
    pro: 'email · 48h target',
    team: 'priority email · 99.9% SLA',
  },
];

export default function PricingPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">pricing</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        three tiers, one engine. start free, upgrade when a project outgrows the caps. prices
        are in USD and exclude tax — VAT (or your local equivalent) is added at checkout for EU
        customers, calculated from your billing country. billing runs on{' '}
        <Link href="https://polar.sh" className="underline hover:text-[var(--color-text)]">
          Polar
        </Link>
        , which is the merchant of record.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <PlanCard
          name="free"
          price="$0"
          blurb="for kicking the tyres, side projects, and local dogfooding. no card required."
        />
        <PlanCard
          name="pro"
          price="$29.99"
          period="/ mo"
          blurb="for a production app: bigger caps, email support, and the 99.5% uptime SLA."
          highlight
        />
        <PlanCard
          name="team"
          price="$99.99"
          period="/ mo"
          blurb="for teams shipping at scale: the largest caps, priority support, and a 99.9% SLA."
        />
      </div>

      <section className="mt-12">
        <h2 className="font-mono text-lg tracking-tight">what each tier includes</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse font-mono text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border-subtle)] text-left text-[var(--color-text-muted)]">
                <th className="py-2 pr-4 font-normal">limit</th>
                <th className="py-2 pr-4 font-normal">free</th>
                <th className="py-2 pr-4 font-normal">pro</th>
                <th className="py-2 pr-4 font-normal">team</th>
              </tr>
            </thead>
            <tbody className="text-[var(--color-text)]">
              {CAPS.map((row) => (
                <tr key={row.label} className="border-b border-[var(--color-border-subtle)]">
                  <td className="py-2 pr-4 text-[var(--color-text-muted)]">{row.label}</td>
                  <td className="py-2 pr-4">{row.free}</td>
                  <td className="py-2 pr-4">{row.pro}</td>
                  <td className="py-2 pr-4">{row.team}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 font-mono text-xs text-[var(--color-text-subtle)]">
          most caps are <em>soft</em> — they surface on the dashboard usage widget and feed
          metered billing rather than hard-stopping your project. concurrent subscriptions and
          the per-org project / function counts are hard caps, enforced at subscribe and deploy
          time. invocations, storage, and connection-seconds bill as metered overage above the
          included amount.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="font-mono text-lg tracking-tight">how to upgrade</h2>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          upgrades happen in the dashboard — there is no sales call and no invoice to chase.
          open your project, go to the <strong>billing</strong> page, pick Pro or Team, and
          you&apos;ll be taken to a hosted Polar checkout. when the subscription is active the
          project&apos;s tier flips automatically (usually within seconds). manage payment
          method, see invoices, or cancel any time from the same billing page&apos;s customer
          portal link.
        </p>
        <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
          <Link
            href="https://briven.tech"
            className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
          >
            open the dashboard → billing
          </Link>{' '}
          to upgrade. questions about a plan? reach us via{' '}
          <Link
            href="https://briven.tech/contact?topic=sales"
            className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
          >
            the contact form
          </Link>
          .
        </p>
      </section>

      <section className="mt-10">
        <h2 className="font-mono text-lg tracking-tight">tax + billing notes</h2>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 font-mono text-sm text-[var(--color-text-muted)]">
          <li>
            prices shown are exclusive of tax. EU customers see VAT added at checkout based on
            their billing country; valid business VAT numbers can be entered in the Polar
            checkout for reverse-charge where applicable.
          </li>
          <li>
            you&apos;re billed monthly. metered overage (extra invocations, storage,
            connection-seconds beyond the included amount) is reconciled on the following
            invoice.
          </li>
          <li>
            free-tier projects are best-effort with no SLA; see the{' '}
            <Link
              href="/sla"
              className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
            >
              service level agreement
            </Link>{' '}
            for the Pro / Team uptime commitments and credit schedule.
          </li>
        </ul>
      </section>
    </DocsShell>
  );
}

function PlanCard({
  name,
  price,
  period,
  blurb,
  highlight,
}: {
  name: string;
  price: string;
  period?: string;
  blurb: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-5 ${
        highlight
          ? 'border-[var(--color-primary)] bg-[var(--color-surface)]'
          : 'border-[var(--color-border-subtle)]'
      }`}
    >
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-text-subtle)]">
        {name}
      </p>
      <p className="mt-2 font-mono text-2xl tracking-tight text-[var(--color-text)]">
        {price}
        {period ? (
          <span className="text-sm text-[var(--color-text-subtle)]">{period}</span>
        ) : null}
      </p>
      <p className="mt-3 font-mono text-xs text-[var(--color-text-muted)]">{blurb}</p>
    </div>
  );
}
