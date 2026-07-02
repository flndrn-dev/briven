import { CreditCardIcon } from '@/components/ui/credit-card';
import { UsersIcon } from '@/components/ui/users';

import { apiJson } from '@/lib/api';
import { toValidDate } from '@/lib/utils';

import { EmptyState } from '../_components/empty-state';
import { Section } from '../_components/section';
import { CountUp, StatCard } from '../_components/stat-card';

export const metadata = { title: 'subscribers & billing · admin' };
export const dynamic = 'force-dynamic';

type Tier = 'free' | 'pro' | 'team';
type SubStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

interface BillingTotals {
  subscribers: number | null;
  mrr: number | null;
  currency: string | null;
  planMix: Record<Tier, number> | null;
  churn30d: number | null;
}

interface SubscriberRow {
  orgId: string;
  orgName: string;
  ownerEmail: string | null;
  tier: Tier;
  status: SubStatus;
  currentPeriodEnd: string | null;
  since: string;
}

/** ISO currency code → display symbol, falling back to the code itself. */
function currencySymbol(code: string | null): string {
  switch (code) {
    case 'EUR':
      return '€';
    case 'USD':
      return '$';
    case 'GBP':
      return '£';
    default:
      return code ? `${code} ` : '';
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = toValidDate(iso);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const TOTALS_FALLBACK: BillingTotals = {
  subscribers: null,
  mrr: null,
  currency: null,
  planMix: null,
  churn30d: null,
};

export default async function AdminBillingPage() {
  const [totals, subsResp] = await Promise.all([
    apiJson<BillingTotals>('/v1/admin/billing/totals').catch(() => TOTALS_FALLBACK),
    apiJson<{ subscribers: SubscriberRow[] }>('/v1/admin/billing/subscribers').catch(() => ({
      subscribers: [] as SubscriberRow[],
    })),
  ]);
  const subscribers = subsResp.subscribers;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-primary)]">
            <CreditCardIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">subscribers &amp; billing</h1>
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          who pays what — plans, mrr, and churn across every account, wired to Mavi Pay. real
          numbers only; anything we can&apos;t yet prove shows &ldquo;—&rdquo; rather than a fake
          zero.
        </p>
      </header>

      {/* ── totals row ───────────────────────────────────────────────── */}
      <Section title="totals · Mavi Pay" icon={<CreditCardIcon size={16} />}>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="paid subscribers"
            value={totals.subscribers}
            icon={<UsersIcon size={14} />}
            tone="primary"
            hint="non-canceled subscriptions"
            waitingOn="Mavi Pay not configured here"
          />
          <StatCard
            label="mrr"
            value={totals.mrr}
            prefix={currencySymbol(totals.currency)}
            decimals={totals.mrr !== null && !Number.isInteger(totals.mrr) ? 2 : 0}
            hint="monthly recurring revenue"
            waitingOn="Mavi Pay not configured here"
          />
          <PlanMixCard planMix={totals.planMix} />
          <StatCard
            label="churn · 30d"
            value={totals.churn30d}
            hint="subscriptions canceled · last 30d"
            waitingOn="Mavi Pay not configured here"
          />
        </div>
      </Section>

      {/* ── subscriber table ─────────────────────────────────────────── */}
      <Section
        title={`subscribers · ${subscribers.length.toLocaleString()}`}
        icon={<UsersIcon size={16} />}
      >
        {subscribers.length === 0 ? (
          <EmptyState
            icon={<CreditCardIcon size={24} />}
            title="no paying subscribers yet"
            message="accounts appear here the moment Mavi Pay records a subscription — no placeholder rows in the meantime."
          />
        ) : (
          <SubscriberTable rows={subscribers} />
        )}
      </Section>
    </div>
  );
}

function PlanMixCard({ planMix }: { planMix: Record<Tier, number> | null }) {
  return (
    <div className="flex h-full flex-col gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
      <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        plan mix
      </p>
      {planMix === null ? (
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-4xl tracking-tight text-[var(--color-text-subtle)]">—</p>
          <p className="font-mono text-[11px] text-[var(--color-text-subtle)]">
            Mavi Pay not configured here
          </p>
        </div>
      ) : (
        <dl className="flex flex-col gap-2 font-mono text-sm">
          {(['free', 'pro', 'team'] as const).map((tier) => (
            <div key={tier} className="flex items-center justify-between">
              <dt className="text-[var(--color-text-muted)]">{tier}</dt>
              <dd className="text-[var(--color-text)]">
                <CountUp value={planMix[tier] ?? 0} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

const STATUS_TONE: Record<SubStatus, string> = {
  active: 'text-[var(--color-success)] border-[var(--color-success)]',
  trialing: 'text-[var(--color-text-link)] border-[var(--color-border-strong)]',
  past_due: 'text-[var(--color-warning)] border-[var(--color-warning)]',
  canceled: 'text-[var(--color-text-subtle)] border-[var(--color-border-subtle)]',
};

function StatusBadge({ status }: { status: SubStatus }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wider ${STATUS_TONE[status]}`}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

function SubscriberTable({ rows }: { rows: SubscriberRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
      <table className="w-full border-collapse font-mono text-xs">
        <thead>
          <tr className="border-b border-[var(--color-border-subtle)] text-left text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
            <th className="px-6 py-3 font-normal">org</th>
            <th className="px-6 py-3 font-normal">plan</th>
            <th className="px-6 py-3 font-normal">status</th>
            <th className="px-6 py-3 font-normal">renews</th>
            <th className="px-6 py-3 font-normal">since</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.orgId}
              className="border-b border-[var(--color-border-subtle)] transition-colors last:border-0 hover:bg-[var(--color-surface-raised)]"
            >
              <td className="px-6 py-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[var(--color-text)]">{r.orgName}</span>
                  {r.ownerEmail ? (
                    <span className="text-[10px] text-[var(--color-text-subtle)]">
                      {r.ownerEmail}
                    </span>
                  ) : null}
                </div>
              </td>
              <td className="px-6 py-4">
                <span className="text-[var(--color-primary)]">{r.tier}</span>
              </td>
              <td className="px-6 py-4">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-6 py-4 text-[var(--color-text-muted)]">
                {fmtDate(r.currentPeriodEnd)}
              </td>
              <td className="px-6 py-4 text-[var(--color-text-muted)]">{fmtDate(r.since)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
