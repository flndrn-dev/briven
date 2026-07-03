import { ApiError, apiJson } from '@/lib/api';

import { EmptyState } from '../_components/empty-state';
import { Section } from '../_components/section';
import { StatCard } from '../_components/stat-card';

interface RealtimeStats {
  totalSubscriptions: number;
  totalChannels: number;
  limits: { perWs: number; perProject: number };
  byProject: { projectId: string; subscriptions: number }[];
  byChannel: { channel: string; subscriptions: number }[];
}

export const dynamic = 'force-dynamic';
// Auto-refresh every 10s — operators keep this page open while watching a
// noisy project hit its cap; meta refresh avoids a client polling component
// and survives the next.js cache (force-dynamic re-fetches each refresh).
export const metadata = {
  title: 'admin · realtime',
  other: { refresh: '10' },
};

function severityClass(pct: number): string {
  if (pct >= 0.9) return 'inline-flex rounded-md bg-red-500/15 px-2 py-0.5 text-red-300';
  if (pct >= 0.6) return 'inline-flex rounded-md bg-yellow-500/15 px-2 py-0.5 text-yellow-300';
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
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="font-mono text-lg">realtime · live snapshot</h2>
        <p className="mt-1 max-w-2xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          per-project subscription counts pulled live from the realtime service — refreshes
          every 10s. numbers reset on a realtime restart; durable usage lives in admin · usage.
        </p>
      </div>

      {errorMsg ? (
        <EmptyState title="realtime unreachable" message={errorMsg} />
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 gap-6 xl:grid-cols-4">
            <StatCard label="total subs" value={stats.totalSubscriptions} />
            <StatCard label="active channels" value={stats.totalChannels} />
            <StatCard label="cap · per ws" value={stats.limits.perWs} />
            <StatCard label="cap · per project" value={stats.limits.perProject} />
          </div>

          <Section title="top projects by subscription count">
            {stats.byProject.length === 0 ? (
              <EmptyState title="no active subscriptions" message="quiet on the wire right now." />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)]">
                <table className="w-full font-mono text-xs">
                  <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
                    <tr>
                      <th className="px-6 py-3 font-medium">project</th>
                      <th className="px-6 py-3 font-medium">subscriptions</th>
                      <th className="px-6 py-3 font-medium">% of cap</th>
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
                          <td className="px-6 py-4 text-[var(--color-text)]">{row.projectId}</td>
                          <td className="px-6 py-4 text-[var(--color-text)]">
                            {row.subscriptions.toLocaleString()}
                          </td>
                          <td className="px-6 py-4">
                            <span className={severityClass(pct)}>{(pct * 100).toFixed(1)}%</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="top channels by subscriber count">
            {stats.byChannel.length === 0 ? (
              <EmptyState title="no active listen channels" message="nothing is subscribed yet." />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)]">
                <table className="w-full font-mono text-xs">
                  <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
                    <tr>
                      <th className="px-6 py-3 font-medium">channel</th>
                      <th className="px-6 py-3 font-medium">subscribers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byChannel.map((row) => (
                      <tr key={row.channel} className="border-t border-[var(--color-border-subtle)]">
                        <td className="px-6 py-4 text-[var(--color-text)]">{row.channel}</td>
                        <td className="px-6 py-4 text-[var(--color-text)]">
                          {row.subscriptions.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      ) : null}
    </div>
  );
}
