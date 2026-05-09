import { apiJson } from '../../../../lib/api';

interface Stats {
  users: number;
  projects: number;
  deployments: number;
}

export const dynamic = 'force-dynamic';

export default async function AdminStatsPage() {
  const stats = await apiJson<Stats>('/v1/admin/stats');

  return (
    <div className="grid grid-cols-3 gap-4">
      <StatCard label="users" value={stats.users} />
      <StatCard label="projects" value={stats.projects} />
      <StatCard label="deployments" value={stats.deployments} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
      <p className="font-mono text-xs text-[var(--color-text-subtle)]">{label}</p>
      <p className="mt-2 font-mono text-3xl">{value.toLocaleString()}</p>
    </div>
  );
}
