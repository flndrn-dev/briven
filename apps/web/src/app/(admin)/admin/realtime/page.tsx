import { apiJson, ApiError } from '@/lib/api';

interface RealtimeStats {
  totalSubscriptions: number;
  totalChannels: number;
  limits: { perWs: number; perProject: number };
  byProject: { projectId: string; subscriptions: number }[];
  byChannel: { channel: string; subscriptions: number }[];
}

export const dynamic = 'force-dynamic';
// Auto-refresh every 10s — operators keep this page open while watching a
// noisy project hit its cap; meta refresh avoids needing a client polling
// component and survives the next.js cache (the page itself is
// force-dynamic so each refresh re-fetches /v1/admin/realtime fresh).
export const metadata = {
  title: 'admin · realtime',
  other: { refresh: '10' },
};

function severityClass(pct: number): string {
  if (pct >= 0.9)
    return 'inline-flex rounded-md bg-red-500/15 px-2 py-0.5 text-red-300';
  if (pct >= 0.6)
    return 'inline-flex rounded-md bg-yellow-500/15 px-2 py-0.5 text-yellow-300';
  return 'inline-flex rounded-md bg-[var(--color-surface)] px-2 py-0.5 text-[var(--color-text-subtle)]';
}

export default async function AdminRealtimePage() {
  let stats: RealtimeStats | null = null;
  let errorMsg: string | null = null;
  try {
    stats = await apiJson<RealtimeStats>('/v1/admin/realtime');
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) {
      errorMsg = 'realtime service is not configured or unreachable.';
    } else {
      throw err;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-mono text-lg">realtime · live snapshot</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          per-project subscription counts pulled live from the realtime service. numbers
          reset on a realtime restart — durable usage is in admin · usage.
        </p>
      </div>

      {errorMsg ? (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6 font-mono text-sm text-[var(--color-text-muted)]">
          {errorMsg}
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card label="total subs" value={String(stats.totalSubscriptions)} />
            <Card label="active channels" value={String(stats.totalChannels)} />
            <Card label="cap · per ws" value={String(stats.limits.perWs)} />
            <Card label="cap · per project" value={String(stats.limits.perProject)} />
          </div>

          <div>
            <h3 className="mb-2 font-mono text-sm text-[var(--color-text-muted)]">
              top projects by subscription count
            </h3>
            {stats.byProject.length === 0 ? (
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6 font-mono text-sm text-[var(--color-text-muted)]">
                no active subscriptions.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
                <table className="w-full font-mono text-xs">
                  <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
                    <tr>
                      <th className="px-3 py-2 font-medium">project</th>
                      <th className="px-3 py-2 font-medium">subscriptions</th>
                      <th className="px-3 py-2 font-medium">% of cap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byProject.map((row) => {
                      const pct = row.subscriptions / stats!.limits.perProject;
                      return (
                        <tr
                          key={row.projectId}
                          className="border-t border-[var(--color-border-subtle)]"
                        >
                          <td className="px-3 py-2 text-[var(--color-text)]">
                            {row.projectId}
                          </td>
                          <td className="px-3 py-2 text-[var(--color-text)]">
                            {row.subscriptions.toLocaleString()}
                          </td>
                          <td className="px-3 py-2">
                            <span className={severityClass(pct)}>
                              {(pct * 100).toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-2 font-mono text-sm text-[var(--color-text-muted)]">
              top channels by subscriber count
            </h3>
            {stats.byChannel.length === 0 ? (
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6 font-mono text-sm text-[var(--color-text-muted)]">
                no active LISTEN channels.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
                <table className="w-full font-mono text-xs">
                  <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
                    <tr>
                      <th className="px-3 py-2 font-medium">channel</th>
                      <th className="px-3 py-2 font-medium">subscribers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byChannel.map((row) => (
                      <tr
                        key={row.channel}
                        className="border-t border-[var(--color-border-subtle)]"
                      >
                        <td className="px-3 py-2 text-[var(--color-text)]">{row.channel}</td>
                        <td className="px-3 py-2 text-[var(--color-text)]">
                          {row.subscriptions.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3">
      <div className="font-mono text-[10px] text-[var(--color-text-muted)]">{label}</div>
      <div className="mt-1 font-mono text-lg text-[var(--color-text)]">{value}</div>
    </div>
  );
}
