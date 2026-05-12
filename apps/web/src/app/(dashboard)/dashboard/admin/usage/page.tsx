import { revalidatePath } from 'next/cache';

import { apiFetch, apiJson } from '../../../../../lib/api';

interface UsageEvent {
  id: string;
  projectId: string;
  metric: 'invocations' | 'storage_bytes' | 'connection_seconds';
  periodStart: string | Date;
  value: string;
  polarPushStatus: 'pending' | 'pushed' | 'skipped';
  polarPushedAt: string | Date | null;
  createdAt: string | Date;
}

export const dynamic = 'force-dynamic';
export const metadata = { title: 'admin · usage' };

const STATUS_FILTERS = [
  { label: 'all', value: '' },
  { label: 'pending', value: 'pending' },
  { label: 'pushed', value: 'pushed' },
  { label: 'skipped', value: 'skipped' },
] as const;

function formatTs(t: string | Date | null): string {
  if (!t) return '—';
  const d = typeof t === 'string' ? new Date(t) : t;
  if (!Number.isFinite(d.getTime())) return String(t);
  return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

function formatValue(metric: UsageEvent['metric'], value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (metric === 'storage_bytes') {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
  if (metric === 'connection_seconds') {
    if (n < 60) return `${n}s`;
    if (n < 3600) return `${(n / 60).toFixed(1)}m`;
    return `${(n / 3600).toFixed(1)}h`;
  }
  // invocations
  return n.toLocaleString();
}

function statusClass(s: UsageEvent['polarPushStatus']): string {
  if (s === 'pushed')
    return 'inline-flex rounded-md bg-[var(--color-primary-subtle)] px-2 py-0.5 text-[var(--color-primary)]';
  if (s === 'pending')
    return 'inline-flex rounded-md bg-yellow-500/10 px-2 py-0.5 text-yellow-300';
  return 'inline-flex rounded-md bg-[var(--color-surface)] px-2 py-0.5 text-[var(--color-text-subtle)]';
}

async function retrySkippedAction(formData: FormData): Promise<void> {
  'use server';
  const sinceDays = Number(formData.get('sinceDays') ?? 7);
  await apiFetch('/v1/admin/usage-events/retry-skipped', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sinceDays }),
  });
  revalidatePath('/dashboard/admin/usage');
}

export default async function AdminUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const qs = status && status !== '' ? `?status=${encodeURIComponent(status)}` : '';
  const { events } = await apiJson<{ events: UsageEvent[] }>(`/v1/admin/usage-events${qs}`);

  const counts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.polarPushStatus] = (acc[e.polarPushStatus] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-mono text-lg">usage events</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          one row per (project × hour × metric), populated by the hourly aggregation cron.
          status='pending' means the polar push worker hasn&apos;t shipped it yet (or polar
          meter ids aren&apos;t configured). status='pushed' means polar accepted the meter
          event.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap items-center gap-2 font-mono text-xs">
          {STATUS_FILTERS.map((f) => {
            const active = (status ?? '') === f.value;
            const count = f.value === '' ? events.length : (counts[f.value] ?? 0);
            return (
              <a
                key={f.value}
                href={`/dashboard/admin/usage${f.value ? `?status=${f.value}` : ''}`}
                className={`rounded-md border px-3 py-1 ${
                  active
                    ? 'border-[var(--color-primary)] bg-[var(--color-surface-raised)] text-[var(--color-text)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                {f.label} · {count}
              </a>
            );
          })}
        </nav>

        {/* Retry-skipped form — only renders when there are skipped rows to do
            something about. Window in days so the same control covers both
            "just fixed the meter id" and reconciliation sweeps. */}
        {(counts.skipped ?? 0) > 0 ? (
          <form action={retrySkippedAction} className="flex items-center gap-2">
            <label className="font-mono text-[10px] text-[var(--color-text-muted)]">
              retry skipped within
            </label>
            <select
              name="sinceDays"
              defaultValue="7"
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)]"
            >
              <option value="1">1d</option>
              <option value="7">7d</option>
              <option value="30">30d</option>
              <option value="90">90d</option>
            </select>
            <button
              type="submit"
              className="rounded-md border border-[var(--color-primary)] bg-[var(--color-primary-subtle)] px-3 py-1 font-mono text-xs text-[var(--color-primary)] hover:bg-[var(--color-primary)]/15"
            >
              retry → pending
            </button>
          </form>
        ) : null}
      </div>

      {events.length === 0 ? (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6 font-mono text-sm text-[var(--color-text-muted)]">
          no usage events yet. the hourly aggregator runs ~5 minutes after every wall-clock
          hour boundary — first row appears within an hour of api boot. if it&apos;s been
          longer, check the api logs for <code>usage_rollup_done</code>.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
          <table className="w-full font-mono text-xs">
            <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">period</th>
                <th className="px-3 py-2 font-medium">project</th>
                <th className="px-3 py-2 font-medium">metric</th>
                <th className="px-3 py-2 font-medium">value</th>
                <th className="px-3 py-2 font-medium">polar</th>
                <th className="px-3 py-2 font-medium">pushed at</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr
                  key={e.id}
                  className="border-t border-[var(--color-border-subtle)] align-top"
                >
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--color-text-subtle)]">
                    {formatTs(e.periodStart)}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">{e.projectId}</td>
                  <td className="px-3 py-2 text-[var(--color-text)]">{e.metric}</td>
                  <td className="px-3 py-2 text-[var(--color-text)]">
                    {formatValue(e.metric, e.value)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={statusClass(e.polarPushStatus)}>
                      {e.polarPushStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-subtle)]">
                    {formatTs(e.polarPushedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
