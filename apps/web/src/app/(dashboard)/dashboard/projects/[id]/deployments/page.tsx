import { apiJson } from '../../../../../../lib/api';

interface Deployment {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  functionCount: string | null;
  schemaDiffSummary: Record<string, number> | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export const dynamic = 'force-dynamic';

export default async function DeploymentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { deployments } = await apiJson<{ deployments: Deployment[] }>(
    `/v1/projects/${id}/deployments?limit=100`,
  );

  if (deployments.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-[var(--color-border)] p-10 text-center font-mono text-sm text-[var(--color-text-muted)]">
        no deployments yet. run <code className="text-[var(--color-text)]">briven deploy</code> from
        your project directory.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {deployments.map((d) => (
        <li
          key={d.id}
          className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3"
        >
          <div className="flex items-center justify-between">
            <p className="font-mono text-sm">{d.id}</p>
            <span className={`font-mono text-xs ${statusColour(d.status)}`}>{d.status}</span>
          </div>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-subtle)]">
            created {new Date(d.createdAt).toISOString().replace('T', ' ').slice(0, 19)}
            {d.finishedAt
              ? ` · finished ${new Date(d.finishedAt).toISOString().replace('T', ' ').slice(11, 19)}`
              : null}
          </p>
          <DiffSummary summary={d.schemaDiffSummary} functionCount={d.functionCount} />
          {d.errorCode ? (
            <p className="mt-2 font-mono text-xs text-red-400">
              {d.errorCode}: {d.errorMessage}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function DiffSummary({
  summary,
  functionCount,
}: {
  summary: Record<string, number> | null;
  functionCount: string | null;
}) {
  const parts: string[] = [];
  if (summary) {
    if (summary.create_table) parts.push(`${summary.create_table} +table`);
    if (summary.drop_table) parts.push(`${summary.drop_table} -table`);
    if (summary.add_column) parts.push(`${summary.add_column} +col`);
    if (summary.drop_column) parts.push(`${summary.drop_column} -col`);
  }
  if (functionCount && functionCount !== '0') parts.push(`${functionCount} fn`);
  if (parts.length === 0) return null;
  return (
    <p className="mt-2 font-mono text-xs text-[var(--color-text-muted)]">{parts.join(' · ')}</p>
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
