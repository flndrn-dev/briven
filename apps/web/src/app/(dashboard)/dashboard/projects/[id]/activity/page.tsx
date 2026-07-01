import Link from 'next/link';

import { apiJson } from '../../../../../../lib/api';

interface Activity {
  id: string;
  action: string;
  actorId: string | null;
  ipHash: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export const dynamic = 'force-dynamic';

const FILTERS = [
  { value: '', label: 'all' },
  { value: 'studio.', label: 'studio' },
  { value: 'deploy', label: 'deploys' },
  { value: 'project.', label: 'project' },
  { value: 'key.', label: 'api keys' },
  { value: 'env.', label: 'env vars' },
  { value: 'invitation.', label: 'invitations' },
] as const;

export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ prefix?: string }>;
}) {
  const { id } = await params;
  const { prefix } = await searchParams;
  const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
  const { activity } = await apiJson<{ activity: Activity[] }>(
    `/v1/projects/${id}/activity${qs}`,
  );

  const filterBar = (
    <nav className="flex flex-wrap gap-1">
      {FILTERS.map((f) => {
        const active = (prefix ?? '') === f.value;
        const href = f.value === ''
          ? `/dashboard/projects/${id}/activity`
          : `/dashboard/projects/${id}/activity?prefix=${encodeURIComponent(f.value)}`;
        return (
          <Link
            key={f.value}
            href={href}
            className={`rounded-md border px-2 py-0.5 font-mono text-[10px] ${
              active
                ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {f.label}
          </Link>
        );
      })}
    </nav>
  );

  if (activity.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <header>
          <h2 className="font-mono text-sm text-[var(--color-text)]">activity</h2>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            every platform-level change: project / key / member / env / deployment / studio.
          </p>
        </header>
        {filterBar}
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-10 text-center font-mono text-sm text-[var(--color-text-muted)]">
          {prefix
            ? `no ${prefix.replace(/\.$/, '')} activity yet.`
            : 'no activity yet.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">activity</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          every platform-level change: project / key / member / env / deployment / studio.
        </p>
      </header>
      {filterBar}

      <ul className="flex flex-col">
        {activity.map((a) => (
          <li
            key={a.id}
            className="flex items-start justify-between gap-4 border-b border-[var(--color-border-subtle)] py-3 last:border-b-0"
          >
            <div className="flex-1">
              <p className="font-mono text-sm">
                <span className="text-[var(--color-primary)]">{a.action}</span>
                {a.actorId ? (
                  <span className="ml-2 text-[var(--color-text-muted)]">
                    by {a.actorId.slice(0, 12)}…
                  </span>
                ) : null}
              </p>
              {a.metadata && Object.keys(a.metadata).length > 0 ? (
                <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                  {formatMeta(a.metadata)}
                </p>
              ) : null}
            </div>
            <time className="font-mono text-xs text-[var(--color-text-subtle)]">
              {new Date(a.createdAt).toISOString().replace('T', ' ').slice(0, 19)}
            </time>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatMeta(meta: Record<string, unknown>): string {
  return Object.entries(meta)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' · ');
}
