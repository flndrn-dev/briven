import { apiJson } from '../../../../../../lib/api.js';
import { InvokePanel } from './invoke-panel.js';

interface Deployment {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  createdAt: string;
  functionNames: string[] | null;
}

export const dynamic = 'force-dynamic';

export default async function FunctionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">functions</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          served from deployment{' '}
          <code className="text-[var(--color-text)]">{current.id}</code> ·{' '}
          {names.length} function{names.length === 1 ? '' : 's'} · status{' '}
          <span className="text-[var(--color-text)]">{current.status}</span>
        </p>
      </header>

      <ul className="flex flex-col gap-4">
        {names.map((name) => (
          <li key={name}>
            <InvokePanel projectId={id} functionName={name} />
          </li>
        ))}
      </ul>
    </div>
  );
}
