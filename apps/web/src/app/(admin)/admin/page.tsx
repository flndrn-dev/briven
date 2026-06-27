import Link from 'next/link';

import { ActivityIcon } from '@/components/ui/activity';
import { CreditCardIcon } from '@/components/ui/credit-card';
import { DatabaseIcon } from '@/components/ui/database';
import { RocketIcon } from '@/components/ui/rocket';
import { TriangleAlertIcon } from '@/components/ui/triangle-alert';

import { apiJson } from '../../../lib/api';

export const metadata = { title: 'overview · admin' };
export const dynamic = 'force-dynamic';

type HealthCheck = 'ok' | 'unreachable' | 'not_configured';

interface Overview {
  billing: {
    subscribers: number | null;
    mrr: number | null;
    currency: string | null;
    planMix: { free: number; pro: number; team: number } | null;
    churn30d: number | null;
  };
  health: {
    checks: {
      control_postgres: HealthCheck;
      data_plane_postgres: HealthCheck;
      runtime: HealthCheck;
      redis: HealthCheck;
    };
    host: null;
  };
  openIncidents: number;
  recentDeploys: Array<{
    id: string;
    service: string;
    buildSha: string;
    buildAt: string | null;
    env: string;
    bootedAt: string;
  }>;
  counts: { projects: number; users: number };
}

export default async function AdminOverviewPage() {
  const data = await apiJson<Overview>('/v1/admin/overview');
  const { billing, health, openIncidents, recentDeploys, counts } = data;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-primary)]">
            <ActivityIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">overview</h1>
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          the platform at a glance — money in, engine alive. real numbers only; anything we
          can&apos;t yet prove shows &ldquo;—&rdquo; with what it&apos;s waiting on.
        </p>
      </header>

      {/* ── business row ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <SectionHeading icon={<CreditCardIcon size={16} />} label="business · Mavi Pay" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="paid subscribers"
            value={billing.subscribers === null ? null : billing.subscribers.toLocaleString()}
            tone="primary"
            hint="non-deleted projects on pro + team"
          />
          <MetricCard
            label="mrr"
            value={
              billing.mrr === null
                ? null
                : `${currencySymbol(billing.currency)}${billing.mrr.toLocaleString()}`
            }
            hint={billing.mrr === null ? undefined : 'monthly recurring revenue'}
            waitingOn="Mavi Pay not configured"
          />
          <PlanMixCard planMix={billing.planMix} />
          <MetricCard
            label="churn · 30d"
            value={billing.churn30d === null ? null : billing.churn30d.toLocaleString()}
            hint="subscriptions canceled · last 30d"
          />
        </div>
      </section>

      {/* ── platform row ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <SectionHeading icon={<ActivityIcon size={16} />} label="platform" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SystemHealthCard checks={health.checks} />
          <MetricCard
            label="server cpu · ram · disk"
            value={null}
            waitingOn="platform health · Phase 4"
          />
          <IncidentsCard count={openIncidents} />
          <MetricCard
            label="projects · users"
            value={`${counts.projects.toLocaleString()} · ${counts.users.toLocaleString()}`}
            icon={<DatabaseIcon size={16} />}
            hint="non-deleted totals"
          />
        </div>
        <RecentDeploys deploys={recentDeploys} />
      </section>
    </div>
  );
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
 * A single stat. `value === null` is the HARD honesty case: render "—"
 * plus a tiny label of what it's waiting on, never a fake 0.
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
  const valueClass = tone === 'primary' ? 'text-[var(--color-primary)]' : 'text-[var(--color-text)]';
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

function PlanMixCard({
  planMix,
}: {
  planMix: { free: number; pro: number; team: number } | null;
}) {
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

const HEALTH_LABELS: Record<string, string> = {
  control_postgres: 'control db',
  data_plane_postgres: 'data plane',
  runtime: 'runtime',
  redis: 'redis',
};

function healthDotClass(state: HealthCheck): string {
  if (state === 'ok') return 'bg-[var(--color-success)]';
  if (state === 'unreachable') return 'bg-[var(--color-error)]';
  return 'bg-[var(--color-warning)]'; // not_configured
}

function SystemHealthCard({
  checks,
}: {
  checks: Record<string, HealthCheck>;
}) {
  return (
    <CardShell>
      <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        <span className="text-[var(--color-text-muted)]">
          <ActivityIcon size={14} />
        </span>
        system health
      </p>
      <ul className="mt-0.5 flex flex-col gap-1.5 font-mono text-xs">
        {(['control_postgres', 'data_plane_postgres', 'runtime', 'redis'] as const).map((key) => (
          <li key={key} className="flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${healthDotClass(checks[key]!)}`}
              aria-hidden
            />
            <span className="text-[var(--color-text-muted)]">{HEALTH_LABELS[key]}</span>
            <span className="ml-auto text-[var(--color-text-subtle)]">
              {checks[key] === 'not_configured' ? 'not configured' : checks[key]}
            </span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

function IncidentsCard({ count }: { count: number }) {
  const tone = count > 0 ? 'text-[var(--color-warning)]' : 'text-[var(--color-text)]';
  return (
    <Link
      href="/dashboard/admin/incidents"
      className="flex h-full flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-border-strong)]"
    >
      <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        <span className="text-[var(--color-text-muted)]">
          <TriangleAlertIcon size={14} />
        </span>
        open incidents
      </p>
      <p className={`font-mono text-2xl ${tone}`}>{count.toLocaleString()}</p>
      <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">unresolved · live</p>
    </Link>
  );
}

function RecentDeploys({ deploys }: { deploys: Overview['recentDeploys'] }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      <Link
        href="/dashboard/admin/deploys"
        className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)] transition hover:text-[var(--color-text-link)]"
      >
        <span className="text-[var(--color-text-muted)]">
          <RocketIcon size={14} />
        </span>
        recent deploys · last 3
      </Link>
      {deploys.length === 0 ? (
        <p className="mt-3 font-mono text-xs text-[var(--color-text-subtle)]">
          no deploys recorded yet
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {deploys.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 font-mono text-xs"
            >
              <span className="flex items-center gap-2">
                <span className="text-[var(--color-primary)]">{d.service}</span>
                <span className="text-[var(--color-text-muted)]">{d.buildSha.slice(0, 7)}</span>
                <span className="rounded-full border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                  {d.env}
                </span>
              </span>
              <time className="shrink-0 text-[var(--color-text-subtle)]" dateTime={d.bootedAt}>
                {new Date(d.bootedAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
