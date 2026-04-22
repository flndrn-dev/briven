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

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { activity } = await apiJson<{ activity: Activity[] }>(
    `/v1/projects/${id}/activity`,
  );

  if (activity.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-[var(--color-border)] p-10 text-center font-mono text-sm text-[var(--color-text-muted)]">
        no activity yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">activity</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          every platform-level change: project / key / member / env / deployment.
        </p>
      </header>

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
