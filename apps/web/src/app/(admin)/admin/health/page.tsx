import { ActivityIcon } from '@/components/ui/activity';
import { DatabaseIcon } from '@/components/ui/database';
import { TriangleAlertIcon } from '@/components/ui/triangle-alert';
import { ZapIcon } from '@/components/ui/zap';

import { apiJson } from '@/lib/api';

export const metadata = { title: 'platform health · admin' };
export const dynamic = 'force-dynamic';

type HealthCheck = 'ok' | 'unreachable' | 'not_configured';

interface HostMetrics {
  cpuPercent: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  diskPercent: number | null;
  stealPercent: number | null;
  instance?: string;
}

interface HealthSummary {
  checks: {
    control_postgres: HealthCheck;
    data_plane_postgres: HealthCheck;
    runtime: HealthCheck;
    redis: HealthCheck;
  };
  host: HostMetrics | null;
}

export default async function AdminHealthPage() {
  const { checks, host } = await apiJson<HealthSummary>('/v1/admin/health');

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-primary)]">
            <ActivityIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">platform health</h1>
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          live signal on the engine — dependency checks and real host load. real numbers only;
          anything we can&apos;t prove shows &ldquo;—&rdquo; with what it&apos;s waiting on.
        </p>
      </header>

      {/* ── dependency checks ────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <SectionHeading icon={<DatabaseIcon size={16} />} label="dependency checks" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ['control_postgres', 'control db'],
              ['data_plane_postgres', 'data plane'],
              ['runtime', 'runtime'],
              ['redis', 'redis'],
            ] as const
          ).map(([key, label]) => (
            <CheckCard key={key} label={label} state={checks[key]} />
          ))}
        </div>
      </section>

      {/* ── host load ────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          icon={<ActivityIcon size={16} />}
          label={host?.instance ? `host load · ${host.instance}` : 'host load'}
        />
        {host === null ? (
          <MonitoringNotConnected />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <UsageCard
              label="cpu"
              icon={<ActivityIcon size={14} />}
              percent={host.cpuPercent}
              redAt={85}
              amberAt={70}
            />
            <MemoryCard usedBytes={host.memUsedBytes} totalBytes={host.memTotalBytes} />
            <UsageCard
              label="disk · /"
              icon={<DatabaseIcon size={14} />}
              percent={host.diskPercent}
              redAt={85}
              amberAt={70}
            />
            <UsageCard
              label="cpu steal"
              icon={<ZapIcon size={14} />}
              percent={host.stealPercent}
              redAt={25}
              amberAt={10}
            />
          </div>
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

function dotClass(state: HealthCheck): string {
  if (state === 'ok') return 'bg-[var(--color-success)]';
  if (state === 'unreachable') return 'bg-[var(--color-error)]';
  return 'bg-[var(--color-warning)]'; // not_configured
}

function CheckCard({ label, state }: { label: string; state: HealthCheck }) {
  return (
    <CardShell>
      <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(state)}`}
          aria-hidden
        />
        <span className="font-mono text-sm text-[var(--color-text)]">
          {state === 'not_configured' ? 'not configured' : state}
        </span>
      </div>
    </CardShell>
  );
}

/**
 * A percent gauge with green/amber/red thresholds. `percent === null` is
 * the HARD honesty case — render "—", a muted bar, and never a fake 0%.
 */
function UsageCard({
  label,
  icon,
  percent,
  redAt,
  amberAt,
}: {
  label: string;
  icon: React.ReactNode;
  percent: number | null;
  redAt: number;
  amberAt: number;
}) {
  const tone = usageTone(percent, redAt, amberAt);
  const barColor =
    tone === 'error'
      ? 'var(--color-error)'
      : tone === 'warning'
        ? 'var(--color-warning)'
        : 'var(--color-success)';
  const valueColor =
    tone === 'error'
      ? 'text-[var(--color-error)]'
      : tone === 'warning'
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--color-text)]';

  return (
    <CardShell>
      <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        <span className="text-[var(--color-text-muted)]">{icon}</span>
        {label}
      </p>
      {percent === null ? (
        <>
          <p className="font-mono text-2xl text-[var(--color-text-subtle)]">—</p>
          <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">no data</p>
        </>
      ) : (
        <>
          <p className={`font-mono text-2xl ${valueColor}`}>{percent.toFixed(1)}%</p>
          <div
            className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border-subtle)]"
            role="meter"
            aria-valuenow={Math.round(percent)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={label}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, percent))}%`, backgroundColor: barColor }}
            />
          </div>
        </>
      )}
    </CardShell>
  );
}

function MemoryCard({
  usedBytes,
  totalBytes,
}: {
  usedBytes: number | null;
  totalBytes: number | null;
}) {
  const percent =
    usedBytes !== null && totalBytes !== null && totalBytes > 0
      ? (usedBytes / totalBytes) * 100
      : null;
  const tone = usageTone(percent, 85, 70);
  const valueColor =
    tone === 'error'
      ? 'text-[var(--color-error)]'
      : tone === 'warning'
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--color-text)]';

  return (
    <CardShell>
      <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        <span className="text-[var(--color-text-muted)]">
          <DatabaseIcon size={14} />
        </span>
        memory
      </p>
      {usedBytes === null || totalBytes === null ? (
        <>
          <p className="font-mono text-2xl text-[var(--color-text-subtle)]">—</p>
          <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">no data</p>
        </>
      ) : (
        <>
          <p className={`font-mono text-2xl ${valueColor}`}>
            {formatGiB(usedBytes)}
            <span className="text-sm text-[var(--color-text-subtle)]">
              {' '}
              / {formatGiB(totalBytes)} GB
            </span>
          </p>
          <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
            {percent === null ? '' : `${percent.toFixed(1)}% used`}
          </p>
        </>
      )}
    </CardShell>
  );
}

function MonitoringNotConnected() {
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      <span className="text-[var(--color-text-muted)]">
        <TriangleAlertIcon size={14} />
      </span>
      <p className="font-mono text-xs text-[var(--color-text-subtle)]">
        monitoring not connected — host CPU/RAM/disk appear once Prometheus is wired up.
      </p>
    </div>
  );
}

/** Shared green/amber/red mapping. null → 'muted' (renders "—"). */
function usageTone(
  percent: number | null,
  redAt: number,
  amberAt: number,
): 'muted' | 'success' | 'warning' | 'error' {
  if (percent === null) return 'muted';
  if (percent >= redAt) return 'error';
  if (percent >= amberAt) return 'warning';
  return 'success';
}

/** Bytes → GB string (decimal, 1dp) for human-readable memory display. */
function formatGiB(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1);
}
