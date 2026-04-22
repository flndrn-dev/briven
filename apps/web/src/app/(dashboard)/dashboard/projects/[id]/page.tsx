import { apiJson } from '../../../../../lib/api.js';

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

export const dynamic = 'force-dynamic';

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { project } = await apiJson<{ project: Project }>(`/v1/projects/${id}`);
  const { deployments } = await apiJson<{ deployments: Deployment[] }>(
    `/v1/projects/${id}/deployments?limit=5`,
  ).catch(() => ({ deployments: [] as Deployment[] }));

  const endpoint = `${project.slug}.apps.briven.cloud`;
  const latest = deployments[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4">
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
        <Card
          label="functions (last deploy)"
          value={latest?.functionCount ?? '—'}
        />
      </div>

      <div>
        <h2 className="mb-3 font-mono text-sm text-[var(--color-text-muted)]">recent deployments</h2>
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

function Card({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      <p className="font-mono text-xs text-[var(--color-text-subtle)]">{label}</p>
      <p className={`mt-1 text-sm ${mono ? 'font-mono' : ''}`}>{value}</p>
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
