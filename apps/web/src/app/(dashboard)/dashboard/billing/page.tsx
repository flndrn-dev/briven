import { apiJson } from '../../../../lib/api';
import { requireUser } from '../../../../lib/session';
import { ManageBillingButton } from './manage-billing-button';
import { UpgradeButtons } from './upgrade-buttons';

export const metadata = { title: 'billing' };
export const dynamic = 'force-dynamic';

interface SubscriptionSummary {
  tier: 'free' | 'pro' | 'team';
  status: 'free' | 'trialing' | 'active' | 'past_due' | 'canceled';
  currentPeriodEnd: string | null;
  canceledAt: string | null;
  polarCustomerId: string | null;
}

interface Plan {
  tier: 'pro' | 'team';
  productId: string;
}

const TIER_INCLUDED: Record<
  SubscriptionSummary['tier'],
  Array<{ label: string; value: string }>
> = {
  free: [
    { label: 'function invocations', value: '1M / mo' },
    { label: 'database', value: '1 gb' },
    { label: 'file storage', value: '1 gb' },
    { label: 'bandwidth', value: '10 gb / mo' },
    { label: 'realtime connections', value: '100 concurrent' },
    { label: 'log retention', value: '7 days' },
  ],
  pro: [
    { label: 'function invocations', value: '10M / mo' },
    { label: 'database', value: '10 gb' },
    { label: 'file storage', value: '50 gb' },
    { label: 'bandwidth', value: '100 gb / mo' },
    { label: 'realtime connections', value: '1,000 concurrent' },
    { label: 'log retention', value: '30 days' },
  ],
  team: [
    { label: 'function invocations', value: '100M / mo' },
    { label: 'database', value: '100 gb' },
    { label: 'file storage', value: '500 gb' },
    { label: 'bandwidth', value: '1 tb / mo' },
    { label: 'realtime connections', value: '10,000 concurrent' },
    { label: 'log retention', value: '90 days' },
  ],
};

const TIER_PRICE: Record<SubscriptionSummary['tier'], string> = {
  free: '€0 / month',
  pro: '€29 / month',
  team: '€99 / month',
};

const STATUS_LABEL: Record<SubscriptionSummary['status'], string> = {
  free: '—',
  trialing: 'trialing',
  active: 'active',
  past_due: 'payment past due',
  canceled: 'canceled',
};

function renewalDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toISOString().slice(0, 10);
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  await requireUser();
  const { checkout } = await searchParams;

  const subscription = await apiJson<SubscriptionSummary>('/v1/billing/subscription').catch(() => ({
    tier: 'free' as const,
    status: 'free' as const,
    currentPeriodEnd: null,
    canceledAt: null,
    polarCustomerId: null,
  }));

  const { plans } = await apiJson<{ plans: Plan[] }>('/v1/billing/plans').catch(() => ({
    plans: [] as Plan[],
  }));

  const tier = subscription.tier;
  const isCheckoutSuccess = checkout === 'success';

  return (
    <div className="flex max-w-4xl flex-col gap-10 pb-12">
      {isCheckoutSuccess ? (
        <div className="rounded-md border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] px-4 py-3 font-mono text-sm text-[var(--color-primary)]">
          payment received · your new plan is active · it can take a few seconds for the tier pill
          to update below
        </div>
      ) : null}

      <header>
        <h1 className="font-mono text-lg text-[var(--color-text)]">billing</h1>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          plan, usage allowance, payments, invoices. cards, refunds, and cancellation are handled
          through the polar.sh customer portal.
        </p>
      </header>

      {/* Current plan card */}
      <section className="flex flex-col gap-4 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-subtle)]">
              current plan
            </p>
            <div className="flex items-baseline gap-3">
              <span className="rounded bg-[var(--color-primary-subtle)] px-2 py-0.5 font-mono text-sm text-[var(--color-primary)]">
                {tier}
              </span>
              <span className="font-mono text-xs text-[var(--color-text-muted)]">
                {TIER_PRICE[tier]}
              </span>
            </div>
          </div>
          <dl className="grid grid-cols-[110px_1fr] gap-y-1 font-mono text-xs">
            <dt className="text-[var(--color-text-subtle)]">status</dt>
            <dd className="text-[var(--color-text)]">
              {STATUS_LABEL[subscription.status] ?? subscription.status}
              {subscription.canceledAt ? (
                <span className="ml-2 text-[var(--color-text-subtle)]">
                  cancels {renewalDate(subscription.currentPeriodEnd)}
                </span>
              ) : null}
            </dd>

            <dt className="text-[var(--color-text-subtle)]">
              {subscription.canceledAt ? 'access until' : 'renews'}
            </dt>
            <dd className="text-[var(--color-text)]">
              {renewalDate(subscription.currentPeriodEnd)}
            </dd>

            <dt className="text-[var(--color-text-subtle)]">processor</dt>
            <dd className="text-[var(--color-text-muted)]">
              Polar.sh{' '}
              <span className="text-[var(--color-text-subtle)]">· mavi Pay arrives later</span>
            </dd>
          </dl>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-[var(--color-border-subtle)] pt-4">
          {plans.length > 0 ? (
            <UpgradeButtons plans={plans} currentTier={tier} />
          ) : (
            <p className="font-mono text-xs text-[var(--color-text-subtle)]">
              plan switching unavailable — Polar product env vars are not configured on the api.
            </p>
          )}
          {subscription.polarCustomerId ? (
            <ManageBillingButton label="payment method · invoices · cancel" />
          ) : null}
        </div>
      </section>

      {/* Included allowance card */}
      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-mono text-sm text-[var(--color-text)]">included this month</h2>
          <span className="font-mono text-xs text-[var(--color-text-subtle)]">
            usage metering arrives in phase 4
          </span>
        </div>
        <dl className="grid grid-cols-[200px_1fr] gap-y-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 font-mono text-sm">
          {TIER_INCLUDED[tier].map((row) => (
            <FragmentRow key={row.label} label={row.label} value={row.value} />
          ))}
        </dl>
        <p className="font-mono text-xs text-[var(--color-text-subtle)]">
          phase 2/3 enforces hard caps at these limits. the meter + overage billing turn on for
          public beta (phase 4).
        </p>
      </section>

      {/* Invoices / orders pointer */}
      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm text-[var(--color-text)]">invoices</h2>
        <div className="rounded-md border border-dashed border-[var(--color-border)] bg-transparent p-6 font-mono text-sm text-[var(--color-text-muted)]">
          {subscription.polarCustomerId ? (
            <>
              <p>invoices and order history live on the polar customer portal.</p>
              <div className="mt-3">
                <ManageBillingButton label="open polar portal" />
              </div>
            </>
          ) : (
            <p>no invoices yet. start a paid plan to see billing history.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[var(--color-text-subtle)]">{label}</dt>
      <dd className="text-[var(--color-text)]">{value}</dd>
    </>
  );
}
