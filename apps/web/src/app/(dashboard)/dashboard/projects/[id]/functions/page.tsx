import Link from 'next/link';

import { apiJson } from '../../../../../../lib/api';
import { InvokePanel } from './invoke-panel';

interface Deployment {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  createdAt: string;
  functionNames: string[] | null;
}

interface FunctionStats {
  count: number;
  errCount: number;
  p50Ms: number;
  p99Ms: number;
  sinceHours: number;
}

export const dynamic = 'force-dynamic';

export default async function FunctionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { deployments } = await apiJson<{ deployments: Deployment[] }>(
    `/v1/projects/${id}/deployments?limit=1`,
  );

  const current = deployments[0];
  const live = current && current.status !== 'failed' && current.status !== 'cancelled';
  const names = live ? (current.functionNames ?? []) : [];

  if (!live || names.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-[var(--color-border)] p-10 text-center font-mono text-sm text-[var(--color-text-muted)]">
        no live functions. add files under <code>briven/functions/</code> and run{' '}
        <code className="text-[var(--color-text)]">briven deploy</code>.
      </p>
    );
  }

  const stats = await Promise.all(
    names.map(async (name) => {
      const s = await apiJson<FunctionStats>(
        `/v1/projects/${id}/function-stats?function=${encodeURIComponent(name)}`,
      ).catch(() => null);
      return [name, s] as const;
    }),
  );
  const statsByName = new Map(stats);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">functions</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          served from deployment <code className="text-[var(--color-text)]">{current.id}</code> ·{' '}
          {names.length} function{names.length === 1 ? '' : 's'} · status{' '}
          <span className="text-[var(--color-text)]">{current.status}</span>
        </p>
      </header>

      <ul className="flex flex-col gap-4">
        {names.map((name) => {
          const s = statsByName.get(name) ?? null;
          const hasInvokes = s && s.count > 0;
          return (
            <li key={name} className="flex flex-col gap-2">
              {hasInvokes ? (
                <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-[var(--color-text-muted)]">
                  <span>
                    last 24h:{' '}
                    <span className="text-[var(--color-text)]">{s.count.toLocaleString()}</span>{' '}
                    invocations
                  </span>
                  {s.errCount > 0 ? (
                    <span className="text-red-400">
                      {s.errCount} err ({Math.round((100 * s.errCount) / s.count)}%)
                    </span>
                  ) : (
                    <span className="text-[var(--color-text-subtle)]">0 errors</span>
                  )}
                  <span>
                    p50 <span className="text-[var(--color-text)]">{s.p50Ms}ms</span>
                  </span>
                  <span>
                    p99 <span className="text-[var(--color-text)]">{s.p99Ms}ms</span>
                  </span>
                  <Link
                    href={`/dashboard/projects/${id}/logs?function=${encodeURIComponent(name)}`}
                    className="ml-auto text-[var(--color-text-link)] hover:underline"
                  >
                    logs →
                  </Link>
                </div>
              ) : null}
              <InvokePanel projectId={id} functionName={name} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
