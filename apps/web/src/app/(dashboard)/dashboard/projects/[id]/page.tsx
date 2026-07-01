import Link from 'next/link';

import { apiJson } from '../../../../../lib/api';
import { InvocationsSparkline } from './invocations-sparkline';

interface Project {
  id: string;
  slug: string;
}

interface Deployment {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  createdAt: string;
  functionCount: string | null;
}

interface UsageResponse {
  tier: 'free' | 'pro' | 'team';
  invocations: { count: number; totalDurationMs: number };
  storage: { bytes: number; tableCount: number };
  connection: { seconds: number };
  limits: {
    invokesPerMonth: number;
    storageBytes: number;
    connectionSecondsPerMonth: number;
    concurrentSubscriptions: number;
  };
}

interface FunctionLog {
  id: string;
  functionName: string;
  status: 'ok' | 'err';
  durationMs: string;
  errCode: string | null;
  errMessage: string | null;
  createdAt: string;
}

export const dynamic = 'force-dynamic';

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  if (s < 86_400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86_400).toFixed(1)}d`;
}

export default async function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { project } = await apiJson<{ project: Project }>(`/v1/projects/${id}`);
  const { deployments } = await apiJson<{ deployments: Deployment[] }>(
    `/v1/projects/${id}/deployments?limit=5`,
  ).catch(() => ({ deployments: [] as Deployment[] }));
  const usage = await apiJson<UsageResponse>(`/v1/projects/${id}/usage`).catch(() => null);
  const { logs: recentErrors } = await apiJson<{ logs: FunctionLog[] }>(
    `/v1/projects/${id}/function-logs?status=err&limit=5`,
  ).catch(() => ({ logs: [] as FunctionLog[] }));
  const { hours } = await apiJson<{
    hours: Array<{ hour: string; count: number; errCount: number }>;
  }>(`/v1/projects/${id}/hourly-invocations`).catch(() => ({
    hours: [] as Array<{ hour: string; count: number; errCount: number }>,
  }));
  // Realtime stats — surfaces a cap-warning banner. Catches the 503 the
  // api returns when realtime is unconfigured/unreachable so the rest of
  // the page still renders.
  const rtStats = await apiJson<{ subscriptions: number; limit: number; fillRatio: number }>(
    `/v1/projects/${id}/realtime-stats`,
  ).catch(() => null);

  const endpoint = `${project.slug}.apps.briven.tech`;
  const latest = deployments[0];

  // Banner copy + colour driven by fill ratio. 75% = yellow (heads-up),
  // 90% = red (act now). Below 75% we render nothing so the page stays
  // quiet during normal operation.
  const rtBanner =
    rtStats && rtStats.fillRatio >= 0.75
      ? {
          severity: rtStats.fillRatio >= 0.9 ? 'red' : 'yellow',
          message: `using ${rtStats.subscriptions.toLocaleString()} of ${rtStats.limit.toLocaleString()} concurrent realtime subscriptions (${Math.round(rtStats.fillRatio * 100)}% of your tier cap)`,
        }
      : null;

  return (
    <div className="flex flex-col gap-6">
      {rtBanner ? (
        <div
          className={`rounded-md border px-4 py-3 font-mono text-xs ${
            rtBanner.severity === 'red'
              ? 'border-red-400/40 bg-red-400/10 text-red-200'
              : 'border-yellow-400/40 bg-yellow-400/10 text-yellow-200'
          }`}
        >
          <span className="mr-2 font-semibold uppercase tracking-wide">
            {rtBanner.severity === 'red' ? 'limit' : 'heads up'}
          </span>
          {rtBanner.message}. once you hit the cap new subscribes are rejected
          with{' '}
          <code className="rounded bg-black/20 px-1">subscription_limit_project</code>.{' '}
          <a
            href="/dashboard/billing"
            className="underline decoration-dotted underline-offset-2"
          >
            upgrade your tier
          </a>{' '}
          to raise it.
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card label="endpoint" value={endpoint} mono />
        <Card label="project id" value={project.id} mono />
        <Card
          label="last deploy"
          value={
            latest
              ? `${latest.status} · ${new Date(latest.createdAt).toISOString().slice(0, 10)}`
              : 'never'
          }
        />
        <Card label="functions (last deploy)" value={latest?.functionCount ?? '—'} />
      </div>

      {hours.length > 0 ? (
        <div>
          <h2 className="mb-3 font-mono text-sm text-[var(--color-text-muted)]">
            invocations · last 24 hours
          </h2>
          <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
            <InvocationsSparkline hours={hours} />
          </div>
        </div>
      ) : null}

      {usage ? (
        <div>
          <h2 className="mb-3 font-mono text-sm text-[var(--color-text-muted)]">
            this month so far
          </h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <QuotaCard
              label="invocations"
              current={usage.invocations.count}
              limit={usage.limits.invokesPerMonth}
              hint={`${usage.tier} tier`}
              formatter={formatCount}
            />
            <QuotaCard
              label="storage"
              current={usage.storage.bytes}
              limit={usage.limits.storageBytes}
              hint={`${usage.storage.tableCount} table${usage.storage.tableCount === 1 ? '' : 's'}`}
              formatter={formatBytes}
            />
            <QuotaCard
              label="realtime"
              current={usage.connection.seconds}
              limit={usage.limits.connectionSecondsPerMonth}
              hint="ws connection-seconds"
              formatter={formatSeconds}
            />
            <Card
              label="compute"
              value={`${Math.round(usage.invocations.totalDurationMs / 1000)}s`}
              hint="aggregated runtime"
            />
          </div>
        </div>
      ) : null}

      {recentErrors.length > 0 ? (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-mono text-sm text-[var(--color-text-muted)]">recent errors</h2>
            <Link
              href={`/dashboard/projects/${id}/logs?status=err`}
              className="font-mono text-[10px] text-[var(--color-text-link)] hover:underline"
            >
              all logs →
            </Link>
          </div>
          <ul className="flex flex-col gap-2">
            {recentErrors.map((log) => (
              <li
                key={log.id}
                className="rounded-md border border-red-400/30 bg-red-400/5 px-3 py-2 font-mono text-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[var(--color-text)]">
                      <span className="text-red-400">err</span> · {log.functionName}
                      <span className="ml-2 text-[var(--color-text-subtle)]">
                        {log.durationMs}ms
                      </span>
                    </p>
                    {log.errMessage ? (
                      <p className="mt-0.5 truncate text-red-400">
                        {log.errCode ? `[${log.errCode}] ` : ''}
                        {log.errMessage}
                      </p>
                    ) : null}
                  </div>
                  <time className="shrink-0 text-[10px] text-[var(--color-text-subtle)]">
                    {new Date(log.createdAt).toISOString().replace('T', ' ').slice(11, 19)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h2 className="mb-3 font-mono text-sm text-[var(--color-text-muted)]">
          recent deployments
        </h2>
        {deployments.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center font-mono text-sm text-[var(--color-text-muted)]">
            no deployments yet. run <code className="text-[var(--color-text)]">briven deploy</code>.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {deployments.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3"
              >
                <div>
                  <p className="font-mono text-sm">{d.id}</p>
                  <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                    {new Date(d.createdAt).toISOString().replace('T', ' ').slice(0, 19)}
                  </p>
                </div>
                <span className={`font-mono text-xs ${statusColour(d.status)}`}>{d.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function QuotaCard({
  label,
  current,
  limit,
  hint,
  formatter,
}: {
  label: string;
  current: number;
  limit: number;
  hint?: string;
  formatter: (n: number) => string;
}) {
  const pct = limit > 0 ? Math.min(100, (current / limit) * 100) : 0;
  // Three bands: under 80% is fine (green), 80-99% is warning (amber),
  // 100%+ is over quota — invokes will start returning 429 within the
  // tier-enforcement cache TTL.
  const over = current >= limit;
  const warn = !over && pct >= 80;
  const barColor = over
    ? 'bg-[var(--color-error)]'
    : warn
      ? 'bg-[var(--color-warning)]'
      : 'bg-[var(--color-primary)]';
  return (
    <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      <p className="font-mono text-xs text-[var(--color-text-subtle)]">{label}</p>
      <p className="mt-1 font-mono text-sm">
        {formatter(current)} / {formatter(limit)}
      </p>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--color-surface-raised)]">
        <div className={`h-full transition-[width] ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <p
        className={`mt-1 font-mono text-[10px] ${
          over
            ? 'text-[var(--color-error)]'
            : warn
              ? 'text-[var(--color-warning)]'
              : 'text-[var(--color-text-subtle)]'
        }`}
      >
        {over
          ? `quota exceeded · new invokes return 429${hint ? ` · ${hint}` : ''}`
          : warn
            ? `${Math.round(pct)}% used${hint ? ` · ${hint}` : ''}`
            : (hint ?? `${Math.round(pct)}% used`)}
      </p>
    </div>
  );
}

function Card({
  label,
  value,
  mono,
  hint,
}: {
  label: string;
  value: string;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      <p className="font-mono text-xs text-[var(--color-text-subtle)]">{label}</p>
      <p className={`mt-1 text-sm ${mono ? 'font-mono' : ''}`}>{value}</p>
      {hint ? (
        <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-subtle)]">{hint}</p>
      ) : null}
    </div>
  );
}

function statusColour(status: Deployment['status']): string {
  switch (status) {
    case 'succeeded':
      return 'text-[var(--color-primary)]';
    case 'failed':
      return 'text-red-400';
    case 'running':
    case 'pending':
      return 'text-[var(--color-text-muted)]';
    case 'cancelled':
      return 'text-[var(--color-text-subtle)]';
  }
}
