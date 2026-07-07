import { ActivityIcon } from '@/components/ui/activity';
import { CreditCardIcon } from '@/components/ui/credit-card';
import { LayoutGridIcon } from '@/components/ui/layout-grid';
import { TriangleAlertIcon } from '@/components/ui/triangle-alert';
import { UsersIcon } from '@/components/ui/users';

import { apiJson } from '@/lib/api';
import { toValidDate } from '@/lib/utils';

import { AreaChart, type AreaChartPoint } from '../_components/area-chart';
import { EmptyState } from '../_components/empty-state';
import { Section } from '../_components/section';
import { CountUp, StatCard } from '../_components/stat-card';

export const metadata = { title: 'revenue · admin' };
export const dynamic = 'force-dynamic';

/* ─── payload type (mirrors /v1/admin/revenue) ───────────────────────────── */

interface Revenue {
  connected: boolean;
  currency: 'EUR';
  mrr: number | null;
  planMix: { free: number; pro: number; team: number };
  activeSubscriptions: Array<{
    orgId: string;
    orgName: string;
    tier: string;
    status: string;
    since: string;
    currentPeriodEnd: string | null;
  }>;
  meteredUsage: Array<{
    metric: string;
    period: string;
    quantity: number;
    unit: string;
    pushStatus: string;
  }>;
  monthlyTimeline: Array<{ month: string; invocations: number; storageRows: number }>;
  note: string;
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

/** 'YYYY-MM' → midnight-UTC ms of the first of that month, or NaN if unparseable. */
function monthToMs(month: string): number {
  return Date.parse(`${month}-01T00:00:00Z`);
}

/** ms → 'jun 25' style lowercase month label. */
function formatMonth(x: number): string {
  return new Date(x)
    .toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })
    .toLowerCase();
}

const REVENUE_FALLBACK: Revenue = {
  connected: false,
  currency: 'EUR',
  mrr: null,
  planMix: { free: 0, pro: 0, team: 0 },
  activeSubscriptions: [],
  meteredUsage: [],
  monthlyTimeline: [],
  note: 'revenue data unavailable — the api didn’t answer or Mavi Pay is not wired up yet.',
};

export default async function AdminRevenuePage() {
  const data = await apiJson<Revenue>('/v1/admin/revenue').catch(() => REVENUE_FALLBACK);

  // Drop unparseable months instead of feeding NaN coordinates to the chart —
  // one odd bucket must never take the whole view down.
  const timeline = (data.monthlyTimeline ?? []).filter((m) =>
    Number.isFinite(monthToMs(m.month)),
  );
  const invocationSeries: AreaChartPoint[] = timeline.map((m) => ({
    x: monthToMs(m.month),
    y: Number(m.invocations) || 0,
  }));
  const storageSeries: AreaChartPoint[] = timeline.map((m) => ({
    x: monthToMs(m.month),
    y: Number(m.storageRows) || 0,
  }));

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-primary)]">
            <CreditCardIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">revenue</h1>
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          the money view — mrr, subscriptions, and what will bill, wired to Mavi Pay. real numbers
          only; anything we can&apos;t yet prove shows &ldquo;—&rdquo; rather than a fake zero.
        </p>
      </header>

      {/* ── honest banner (only when the engine isn't connected) ──────── */}
      {!data.connected ? (
        <div className="flex items-start gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
          <span className="mt-0.5 shrink-0 text-[var(--color-warning)]">
            <TriangleAlertIcon size={16} />
          </span>
          <div className="flex flex-col gap-1.5">
            <p className="font-mono text-sm text-[var(--color-text)]">
              revenue engine not connected
            </p>
            <p className="font-mono text-xs text-[var(--color-text-muted)]">{data.note}</p>
          </div>
        </div>
      ) : null}

      {/* ── top numbers ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="mrr"
          value={data.mrr}
          prefix={currencySymbol(data.currency)}
          decimals={data.mrr !== null && !Number.isInteger(data.mrr) ? 2 : 0}
          icon={<CreditCardIcon size={14} />}
          tone="primary"
          hint="monthly recurring revenue"
          waitingOn="Mavi Pay not connected"
        />
        <StatCard
          label="active subscriptions"
          value={data.activeSubscriptions.length}
          icon={<UsersIcon size={14} />}
          hint="non-canceled subscriptions"
        />
        <PlanMixCard planMix={data.planMix} />
      </div>

      {/* ── what will bill (metered usage) ───────────────────────────── */}
      <Section
        title="what will bill"
        icon={<LayoutGridIcon size={16} />}
        right={
          <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
            metered — bills when Mavi Pay connects
          </span>
        }
      >
        {data.meteredUsage.length === 0 ? (
          <EmptyState
            icon={<LayoutGridIcon size={24} />}
            title="no metered usage yet"
            message="metered line-items appear here as the platform records billable usage."
          />
        ) : (
          <MeteredUsageTable rows={data.meteredUsage} />
        )}
      </Section>

      {/* ── monthly timeline (6 months) ──────────────────────────────── */}
      <Section title="monthly · 6 months" icon={<ActivityIcon size={16} />}>
        <div className="grid grid-cols-1 gap-6">
          <TimelineChartCard
            label="invocations"
            data={invocationSeries}
            ariaLabel="function invocations per month"
          />
          <TimelineChartCard
            label="storage rows"
            data={storageSeries}
            ariaLabel="storage rows per month"
          />
        </div>
      </Section>

      {/* ── active subscriptions ─────────────────────────────────────── */}
      <Section
        title={`active subscriptions · ${data.activeSubscriptions.length}`}
        icon={<UsersIcon size={16} />}
      >
        {data.activeSubscriptions.length === 0 ? (
          <EmptyState
            icon={<CreditCardIcon size={24} />}
            title="no active subscriptions yet"
            message="subscriptions appear here the moment Mavi Pay records one — no placeholder rows in the meantime."
          />
        ) : (
          <SubscriptionTable rows={data.activeSubscriptions} />
        )}
      </Section>
    </div>
  );
}

/* ─── small pieces ───────────────────────────────────────────────────────── */

function PlanMixCard({ planMix }: { planMix: { free: number; pro: number; team: number } }) {
  return (
    <div className="flex h-full flex-col gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
      <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        plan mix
      </p>
      <dl className="flex flex-col gap-2 font-mono text-sm">
        {(['free', 'pro', 'team'] as const).map((tier) => (
          <div key={tier} className="flex items-center justify-between">
            <dt className="text-[var(--color-text-muted)]">{tier}</dt>
            <dd className="text-[var(--color-text)]">
              <CountUp value={planMix[tier]} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** One 6-month timeline series in a surface card, matching the overview cards. */
function TimelineChartCard({
  label,
  data,
  ariaLabel,
}: {
  label: string;
  data: AreaChartPoint[];
  ariaLabel: string;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
      <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        {label}
      </p>
      <AreaChart
        data={data}
        height={200}
        yFormat={(y) => y.toLocaleString('en-US', { maximumFractionDigits: 0 })}
        xFormat={formatMonth}
        ariaLabel={ariaLabel}
        pendingLabel="not enough monthly history yet."
      />
    </div>
  );
}

/** Push status → pill tone. Tolerant of free-form (or missing) status strings. */
function pushTone(status: string | null | undefined): string {
  const s = String(status ?? '').toLowerCase();
  if (/push|sent|ok|synced/.test(s)) {
    return 'text-[var(--color-success)] border-[var(--color-success)]';
  }
  if (/pending|queued/.test(s)) {
    return 'text-[var(--color-warning)] border-[var(--color-warning)]';
  }
  if (/error|failed/.test(s)) {
    return 'text-[var(--color-error)] border-[var(--color-error)]';
  }
  return 'text-[var(--color-text-subtle)] border-[var(--color-border-subtle)]';
}

function MeteredUsageTable({ rows }: { rows: Revenue['meteredUsage'] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
      <table className="w-full border-collapse font-mono text-xs">
        <thead>
          <tr className="border-b border-[var(--color-border-subtle)] text-left text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
            <th className="px-6 py-3 font-normal">metric</th>
            <th className="px-6 py-3 font-normal">period</th>
            <th className="px-6 py-3 font-normal">quantity</th>
            <th className="px-6 py-3 font-normal">push status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${r.metric}-${r.period}-${i}`}
              className="border-b border-[var(--color-border-subtle)] transition-colors last:border-0 hover:bg-[var(--color-surface-raised)]"
            >
              <td className="px-6 py-4 text-[var(--color-text)]">{r.metric}</td>
              <td className="px-6 py-4 text-[var(--color-text-muted)]">{r.period}</td>
              <td className="whitespace-nowrap px-6 py-4 text-[var(--color-text)]">
                {(Number(r.quantity) || 0).toLocaleString()}{' '}
                <span className="text-[var(--color-text-subtle)]">{r.unit}</span>
              </td>
              <td className="px-6 py-4">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wider ${pushTone(
                    r.pushStatus,
                  )}`}
                >
                  {String(r.pushStatus ?? 'pending').replace(/_/g, ' ')}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SUB_STATUS_TONE: Record<string, string> = {
  active: 'text-[var(--color-success)] border-[var(--color-success)]',
  trialing: 'text-[var(--color-text-link)] border-[var(--color-border-strong)]',
  past_due: 'text-[var(--color-warning)] border-[var(--color-warning)]',
  canceled: 'text-[var(--color-text-subtle)] border-[var(--color-border-subtle)]',
};

/** Tolerant status badge — status is a free string per the contract (may be missing). */
function SubStatusBadge({ status }: { status: string | null | undefined }) {
  const label = String(status ?? 'unknown');
  const tone =
    SUB_STATUS_TONE[label.toLowerCase()] ??
    'text-[var(--color-text-subtle)] border-[var(--color-border-subtle)]';
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wider ${tone}`}
    >
      {label.replace(/_/g, ' ')}
    </span>
  );
}

function SubscriptionTable({ rows }: { rows: Revenue['activeSubscriptions'] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
      <table className="w-full border-collapse font-mono text-xs">
        <thead>
          <tr className="border-b border-[var(--color-border-subtle)] text-left text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
            <th className="px-6 py-3 font-normal">org</th>
            <th className="px-6 py-3 font-normal">tier</th>
            <th className="px-6 py-3 font-normal">status</th>
            <th className="px-6 py-3 font-normal">since</th>
            <th className="px-6 py-3 font-normal">renews</th>
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
                  <span className="text-[10px] text-[var(--color-text-subtle)]">{r.orgId}</span>
                </div>
              </td>
              <td className="px-6 py-4">
                <span className="text-[var(--color-primary)]">{r.tier}</span>
              </td>
              <td className="px-6 py-4">
                <SubStatusBadge status={r.status} />
              </td>
              <td className="px-6 py-4 text-[var(--color-text-muted)]">{fmtDate(r.since)}</td>
              <td className="px-6 py-4 text-[var(--color-text-muted)]">
                {fmtDate(r.currentPeriodEnd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
