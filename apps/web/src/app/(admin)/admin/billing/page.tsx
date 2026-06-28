import { CreditCardIcon } from '@/components/ui/credit-card';
import { UsersIcon } from '@/components/ui/users';

import { apiJson } from '@/lib/api';

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

function fmtMrr(mrr: number | null, currency: string | null): string | null {
  if (mrr === null) return null;
  return `${currencySymbol(currency)}${mrr.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default async function AdminBillingPage() {
  const [totals, subsResp] = await Promise.all([
    apiJson<BillingTotals>('/v1/admin/billing/totals'),
    apiJson<{ subscribers: SubscriberRow[] }>('/v1/admin/billing/subscribers'),
  ]);
  const subscribers = subsResp.subscribers;
  const mrr = fmtMrr(totals.mrr, totals.currency);

  return (
    <div className="flex flex-col gap-8">
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

      {/* ── totals header ────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <SectionHeading icon={<CreditCardIcon size={16} />} label="totals · Mavi Pay" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="paid subscribers"
            value={totals.subscribers === null ? null : totals.subscribers.toLocaleString()}
            tone="primary"
            hint="non-canceled subscriptions"
            icon={<UsersIcon size={14} />}
          />
          <MetricCard
            label="mrr"
            value={mrr}
            hint={mrr ? 'monthly recurring revenue' : undefined}
            waitingOn="Mavi Pay not configured here"
          />
          <PlanMixCard planMix={totals.planMix} />
          <MetricCard
            label="churn · 30d"
            value={totals.churn30d === null ? null : totals.churn30d.toLocaleString()}
            hint="subscriptions canceled · last 30d"
          />
        </div>
      </section>

      {/* ── subscriber table ─────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          icon={<UsersIcon size={16} />}
          label={`subscribers · ${subscribers.length.toLocaleString()}`}
        />
        {subscribers.length === 0 ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-8 text-center">
            <p className="font-mono text-sm text-[var(--color-text-muted)]">
              no paying subscribers yet
            </p>
            <p className="mt-1 font-mono text-[10px] text-[var(--color-text-subtle)]">
              accounts appear here the moment Mavi Pay records a subscription.
            </p>
          </div>
        ) : (
          <SubscriberTable rows={subscribers} />
        )}
      </section>
    </div>
  );
}

function SectionHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
      <span className="text-[var(--color-text-muted)]">{icon}</span>
      {label}
    </h2>
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      {children}
    </div>
  );
}

/**
 * A single stat. `value === null` is the HARD honesty case: render "—" plus a
 * tiny label of what it's waiting on, never a fake 0.
 */
function MetricCard({
  label,
  value,
  tone = 'default',
  hint,
  waitingOn,
  icon,
}: {
  label: string;
  value: string | null;
  tone?: 'default' | 'primary';
  hint?: string;
  waitingOn?: string;
  icon?: React.ReactNode;
}) {
  const valueClass =
    tone === 'primary' ? 'text-[var(--color-primary)]' : 'text-[var(--color-text)]';
  return (
    <CardShell>
      <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        {icon ? <span className="text-[var(--color-text-muted)]">{icon}</span> : null}
        {label}
      </p>
      {value === null ? (
        <>
          <p className="font-mono text-2xl text-[var(--color-text-subtle)]">—</p>
          {waitingOn ? (
            <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">{waitingOn}</p>
          ) : null}
        </>
      ) : (
        <>
          <p className={`font-mono text-2xl ${valueClass}`}>{value}</p>
          {hint ? (
            <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">{hint}</p>
          ) : null}
        </>
      )}
    </CardShell>
  );
}

function PlanMixCard({ planMix }: { planMix: Record<Tier, number> | null }) {
  return (
    <CardShell>
      <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        plan mix
      </p>
      {planMix === null ? (
        <p className="font-mono text-2xl text-[var(--color-text-subtle)]">—</p>
      ) : (
        <dl className="mt-0.5 flex flex-col gap-1 font-mono text-xs">
          {(['free', 'pro', 'team'] as const).map((tier) => (
            <div key={tier} className="flex items-center justify-between">
              <dt className="text-[var(--color-text-muted)]">{tier}</dt>
              <dd className="text-[var(--color-text)]">{planMix[tier].toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      )}
    </CardShell>
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
      className={`rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${STATUS_TONE[status]}`}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

function SubscriberTable({ rows }: { rows: SubscriberRow[] }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
      <table className="w-full border-collapse font-mono text-xs">
        <thead>
          <tr className="border-b border-[var(--color-border-subtle)] text-left text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
            <th className="px-4 py-2 font-normal">org</th>
            <th className="px-4 py-2 font-normal">plan</th>
            <th className="px-4 py-2 font-normal">status</th>
            <th className="px-4 py-2 font-normal">renews</th>
            <th className="px-4 py-2 font-normal">since</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.orgId}
              className="border-b border-[var(--color-border-subtle)] last:border-0"
            >
              <td className="px-4 py-2.5">
                <div className="flex flex-col">
                  <span className="text-[var(--color-text)]">{r.orgName}</span>
                  {r.ownerEmail ? (
                    <span className="text-[10px] text-[var(--color-text-subtle)]">
                      {r.ownerEmail}
                    </span>
                  ) : null}
                </div>
              </td>
              <td className="px-4 py-2.5">
                <span className="text-[var(--color-primary)]">{r.tier}</span>
              </td>
              <td className="px-4 py-2.5">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-4 py-2.5 text-[var(--color-text-muted)]">
                {fmtDate(r.currentPeriodEnd)}
              </td>
              <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{fmtDate(r.since)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
