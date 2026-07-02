'use client';

import { useCallback, useEffect, useState } from 'react';

import { ActivityIcon } from '@/components/ui/activity';
import { DatabaseIcon } from '@/components/ui/database';
import { TriangleAlertIcon } from '@/components/ui/triangle-alert';
import { ZapIcon } from '@/components/ui/zap';

import { EmptyState, EmptyStateButton } from '../_components/empty-state';
import { Gauge } from '../_components/gauge';
import { Section } from '../_components/section';

/* ─── payload types (mirror /v1/admin/health) ────────────────────────────── */

type HealthCheck = 'ok' | 'unreachable' | 'not_configured';

interface HostMetrics {
  cpuPercent: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  diskPercent: number | null;
  stealPercent: number | null;
  instance?: string;
}

export interface HealthSummary {
  checks: {
    control_postgres: HealthCheck;
    data_plane_postgres: HealthCheck;
    runtime: HealthCheck;
    redis: HealthCheck;
  };
  host: HostMetrics | null;
}

/* ─── live-polled health board ───────────────────────────────────────────── */

const POLL_MS = 10_000;

export function HealthBoard({
  apiOrigin,
  initial,
}: {
  apiOrigin: string;
  initial: HealthSummary | null;
}) {
  const [data, setData] = useState<HealthSummary | null>(initial);
  const [failed, setFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(initial ? Date.now() : null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/health`, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`health failed: ${res.status}`);
      const json = (await res.json()) as HealthSummary;
      setData(json);
      setUpdatedAt(Date.now());
      setFailed(false);
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
          title="health data unavailable"
          message="the api didn't answer the health check — it may be restarting or your session may have expired."
          action={<EmptyStateButton onClick={() => void load()}>retry now</EmptyStateButton>}
        />
      );
    }
    return (
      <EmptyState
        icon={<ActivityIcon size={28} />}
        title="loading health…"
        message="running the live dependency checks."
      />
    );
  }

  const { checks, host } = data;
  const memPercent =
    host && host.memUsedBytes !== null && host.memTotalBytes !== null && host.memTotalBytes > 0
      ? (host.memUsedBytes / host.memTotalBytes) * 100
      : null;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-primary)]">
              <ActivityIcon size={20} />
            </span>
            <h1 className="font-mono text-xl tracking-tight">platform health</h1>
          </div>
          <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
            live signal on the engine — dependency checks and real host load, refreshed every
            10 seconds. real numbers only; anything we can&apos;t prove shows &ldquo;—&rdquo;.
          </p>
        </div>
        <LiveBadge updatedAt={updatedAt} stale={failed} />
      </header>

      {/* ── dependency checks ────────────────────────────────────────── */}
      <Section title="dependency checks" icon={<DatabaseIcon size={16} />}>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {(
            [
              ['control_postgres', 'control db'],
              ['data_plane_postgres', 'data plane'],
              ['runtime', 'runtime'],
              ['redis', 'redis'],
            ] as const
          ).map(([key, label]) => (
            <CheckTile key={key} label={label} state={checks[key]} />
          ))}
        </div>
      </Section>

      {/* ── host load gauges ─────────────────────────────────────────── */}
      <Section
        title={host?.instance ? `host load · ${host.instance}` : 'host load'}
        icon={<ActivityIcon size={16} />}
      >
        {host === null ? (
          <EmptyState
            icon={<TriangleAlertIcon size={24} />}
            title="monitoring not connected"
            message="host CPU/RAM/disk gauges appear here once Prometheus is wired up — no fabricated percentages in the meantime."
          />
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
            <Gauge
              label="cpu"
              icon={<ActivityIcon size={14} />}
              percent={host.cpuPercent}
              redAt={85}
              amberAt={70}
              detail={host.cpuPercent === null ? undefined : 'busy · all cores'}
            />
            <Gauge
              label="ram"
              icon={<DatabaseIcon size={14} />}
              percent={memPercent}
              redAt={85}
              amberAt={70}
              detail={
                host.memUsedBytes !== null && host.memTotalBytes !== null
                  ? `${formatGiB(host.memUsedBytes)} / ${formatGiB(host.memTotalBytes)} GB`
                  : undefined
              }
            />
            <Gauge
              label="disk · /"
              icon={<DatabaseIcon size={14} />}
              percent={host.diskPercent}
              redAt={85}
              amberAt={70}
              detail={host.diskPercent === null ? undefined : 'root filesystem'}
            />
            <Gauge
              label="cpu steal"
              icon={<ZapIcon size={14} />}
              percent={host.stealPercent}
              redAt={25}
              amberAt={10}
              detail={host.stealPercent === null ? undefined : 'hypervisor contention'}
            />
          </div>
        )}
      </Section>
    </div>
  );
}

/* ─── small pieces ───────────────────────────────────────────────────────── */

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

function CheckTile({ label, state }: { label: string; state: HealthCheck }) {
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

/** Bytes → GB string (decimal, 1dp) for human-readable memory display. */
function formatGiB(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1);
}
