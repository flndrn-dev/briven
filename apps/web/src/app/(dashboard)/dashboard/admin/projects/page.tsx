import Link from 'next/link';

import { apiJson } from '../../../../../lib/api';

interface AdminProject {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  tier: string;
  createdAt: string;
}

export const dynamic = 'force-dynamic';

export default async function AdminProjectsPage() {
  const { projects } = await apiJson<{ projects: AdminProject[] }>('/v1/admin/projects');

  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        {projects.length} project{projects.length === 1 ? '' : 's'} total
      </p>
      <ul className="flex flex-col divide-y divide-[var(--color-border-subtle)]">
        {projects.map((p) => (
          <li key={p.id} className="flex items-center justify-between py-3">
            <div>
              <p className="font-mono text-sm">
                <Link
                  href={`/dashboard/projects/${p.id}`}
                  className="hover:text-[var(--color-primary)]"
                >
                  {p.name}
                </Link>{' '}
                <span className="ml-2 rounded bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)]">
                  {p.tier}
                </span>
              </p>
              <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                {p.id} · {p.slug} · owner {p.ownerId} · created{' '}
                {new Date(p.createdAt).toISOString().slice(0, 10)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
