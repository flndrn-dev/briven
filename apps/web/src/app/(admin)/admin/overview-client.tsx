'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { ActivityIcon } from '@/components/ui/activity';
import { CreditCardIcon } from '@/components/ui/credit-card';
import { DatabaseIcon } from '@/components/ui/database';
import { FoldersIcon } from '@/components/ui/folders';
import { RocketIcon } from '@/components/ui/rocket';
import { TriangleAlertIcon } from '@/components/ui/triangle-alert';
import { UsersIcon } from '@/components/ui/users';

import { AreaChart, type AreaChartPoint } from './_components/area-chart';
import { EmptyState, EmptyStateButton } from './_components/empty-state';
import { Section } from './_components/section';
import { CountUp, StatCard } from './_components/stat-card';

/* ─── payload types (mirror /v1/admin/overview) ──────────────────────────── */

type HealthCheck = 'ok' | 'unreachable' | 'not_configured';

interface HostMetrics {
  cpuPercent: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  diskPercent: number | null;
  stealPercent: number | null;
  instance?: string;
}

export interface Overview {
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
    host: HostMetrics | null;
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

/* ─── live-polled dashboard ──────────────────────────────────────────────── */

const POLL_MS = 10_000;
/** ~20 min of 10s samples for the live cpu chart. */
const MAX_SAMPLES = 120;

export function OverviewDashboard({
  apiOrigin,
  initial,
}: {
  apiOrigin: string;
  initial: Overview | null;
}) {
  const [data, setData] = useState<Overview | null>(initial);
  const [failed, setFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(initial ? Date.now() : null);
  // Real cpu% samples accumulated from the live poll — the chart never
  // shows fabricated history, it grows as genuine samples arrive.
  const [cpuSamples, setCpuSamples] = useState<AreaChartPoint[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/overview`, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`overview failed: ${res.status}`);
      const json = (await res.json()) as Overview;
      setData(json);
      setUpdatedAt(Date.now());
      setFailed(false);
      const cpu = json.health.host?.cpuPercent;
      if (typeof cpu === 'number') {
        setCpuSamples((prev) => [...prev.slice(-(MAX_SAMPLES - 1)), { x: Date.now(), y: cpu }]);
      }
    } catch {
      setFailed(true);
    }
  }, [apiOrigin]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (data === null) {
    if (failed) {
      return (
        <EmptyState
          icon={<TriangleAlertIcon size={28} />}
          title="overview unavailable"
          message="the api didn't answer — it may be restarting or your session may have expired. retrying keeps your place; nothing is lost."
          action={<EmptyStateButton onClick={() => void load()}>retry now</EmptyStateButton>}
        />
      );
    }
    return (
      <EmptyState
        icon={<ActivityIcon size={28} />}
        title="loading overview…"
        message="fetching live platform data."
      />
    );
  }

  const { billing, health, openIncidents, recentDeploys, counts } = data;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
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
        </div>
        <LiveBadge updatedAt={updatedAt} stale={failed} />
      </header>

      {/* ── top row: the four numbers that matter ─────────────────────── */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="users"
          value={counts.users}
          icon={<UsersIcon size={14} />}
          hint="non-deleted accounts"
        />
        <StatCard
          label="projects"
          value={counts.projects}
          icon={<FoldersIcon size={14} />}
          hint="non-deleted totals"
        />
        <StatCard
          label="active incidents"
          value={openIncidents}
          icon={<TriangleAlertIcon size={14} />}
          tone={openIncidents > 0 ? 'warning' : 'default'}
          hint="unresolved · live"
        />
        <StatCard
          label="mrr"
          value={billing.mrr}
          prefix={currencySymbol(billing.currency)}
          icon={<CreditCardIcon size={14} />}
          tone="primary"
          hint="monthly recurring revenue"
          waitingOn="Mavi Pay not configured"
        />
      </div>

      {/* ── live host cpu chart ───────────────────────────────────────── */}
      <Section
        title={
          health.host?.instance ? `host cpu · live · ${health.host.instance}` : 'host cpu · live'
        }
        icon={<ActivityIcon size={16} />}
        right={
          <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
            sampled every 10s this session
          </span>
        }
      >
        {health.host === null ? (
          <EmptyState
            icon={<TriangleAlertIcon size={24} />}
            title="monitoring not connected"
            message="host cpu appears here once Prometheus is wired up — no fake demo curve in the meantime."
          />
        ) : (
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
            <AreaChart
              data={cpuSamples}
              height={200}
              yFormat={(y) => `${y.toFixed(0)}%`}
              xFormat={(x) =>
                new Date(x).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })
              }
              ariaLabel="host cpu percent over the current session"
            />
          </div>
        )}
      </Section>

      {/* ── platform health tiles ─────────────────────────────────────── */}
      <Section
        title="platform health"
        icon={<DatabaseIcon size={16} />}
        right={
          <Link
            href="/admin/health"
            className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)] transition hover:text-[var(--color-text-link)]"
          >
            open health →
          </Link>
        }
      >
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {(
            [
              ['control_postgres', 'control db'],
              ['data_plane_postgres', 'data plane'],
              ['runtime', 'runtime'],
              ['redis', 'redis'],
            ] as const
          ).map(([key, label]) => (
            <HealthTile key={key} label={label} state={health.checks[key]} />
          ))}
        </div>
      </Section>

      {/* ── business row ──────────────────────────────────────────────── */}
      <Section title="business · Mavi Pay" icon={<CreditCardIcon size={16} />}>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="paid subscribers"
            value={billing.subscribers}
            tone="primary"
            hint="non-deleted projects on pro + team"
            waitingOn="Mavi Pay not configured"
          />
          <PlanMixCard planMix={billing.planMix} />
          <StatCard
            label="churn · 30d"
            value={billing.churn30d}
            hint="subscriptions canceled · last 30d"
            waitingOn="Mavi Pay not configured"
          />
        </div>
      </Section>

      {/* ── recent deploys ────────────────────────────────────────────── */}
      <Section
        title="recent deploys · last 3"
        icon={<RocketIcon size={16} />}
        right={
          <Link
            href="/admin/deploys"
            className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)] transition hover:text-[var(--color-text-link)]"
          >
            all deploys →
          </Link>
        }
      >
        {recentDeploys.length === 0 ? (
          <EmptyState
            icon={<RocketIcon size={24} />}
            title="no deploys recorded yet"
            message="the first api or web boot with build metadata will show up here."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            {recentDeploys.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-4 px-6 py-4 font-mono text-xs"
              >
                <span className="flex items-center gap-3">
                  <span className="text-[var(--color-primary)]">{d.service}</span>
                  <span className="text-[var(--color-text-muted)]">{d.buildSha.slice(0, 7)}</span>
                  <span className="rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 text-[9px] uppercase tracking-wider text-[var(--color-text-subtle)]">
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
      </Section>
    </div>
  );
}

/* ─── small pieces ───────────────────────────────────────────────────────── */

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

function LiveBadge({ updatedAt, stale }: { updatedAt: number | null; stale: boolean }) {
  return (
    <span className="flex items-center gap-2 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-[10px] text-[var(--color-text-subtle)]">
      <StatusDot state={stale ? 'unreachable' : 'ok'} />
      {stale
        ? 'stale — retrying'
        : updatedAt
          ? `live · updated ${new Date(updatedAt).toLocaleTimeString()}`
          : 'live'}
    </span>
  );
}

/** Pulsing status dot — green pulse ok, red pulse unreachable, amber static. */
function StatusDot({ state }: { state: HealthCheck }) {
  const color =
    state === 'ok'
      ? 'bg-[var(--color-success)]'
      : state === 'unreachable'
        ? 'bg-[var(--color-error)]'
        : 'bg-[var(--color-warning)]';
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
      {state !== 'not_configured' ? (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${color}`}
        />
      ) : null}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
    </span>
  );
}

function HealthTile({ label, state }: { label: string; state: HealthCheck }) {
  return (
    <div className="flex h-full flex-col gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
      <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        {label}
      </p>
      <div className="flex items-center gap-3">
        <StatusDot state={state} />
        <span className="font-mono text-sm text-[var(--color-text)]">
          {state === 'not_configured' ? 'not configured' : state}
        </span>
      </div>
    </div>
  );
}

function PlanMixCard({
  planMix,
}: {
  planMix: { free: number; pro: number; team: number } | null;
}) {
  return (
    <div className="flex h-full flex-col gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
      <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        plan mix
      </p>
      {planMix === null ? (
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-4xl tracking-tight text-[var(--color-text-subtle)]">—</p>
          <p className="font-mono text-[11px] text-[var(--color-text-subtle)]">
            Mavi Pay not configured
          </p>
        </div>
      ) : (
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
      )}
    </div>
  );
}
