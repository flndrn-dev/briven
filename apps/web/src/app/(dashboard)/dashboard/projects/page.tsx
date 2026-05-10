import Link from 'next/link';

import { apiJson } from '../../../../lib/api';

interface Project {
  id: string;
  slug: string;
  name: string;
  region: string;
  tier: 'free' | 'pro' | 'team';
  createdAt: string;
}

interface PendingInvitation {
  id: string;
  projectName: string;
}

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  // Fetch projects + pending invites in parallel. Invites failure is
  // non-fatal — the banner just doesn't render — so we swallow the error
  // here rather than blocking the projects view.
  const [data, invitesResult] = await Promise.all([
    apiJson<{ projects: Project[] }>('/v1/projects'),
    apiJson<{ invitations: PendingInvitation[] }>('/v1/me/invitations').catch(() => ({
      invitations: [] as PendingInvitation[],
    })),
  ]);
  const projects = data.projects;
  const invitations = invitesResult.invitations;

  return (
    <section>
      {invitations.length > 0 ? (
        <Link
          href="/dashboard/invitations"
          className="mb-6 flex items-center justify-between rounded-md border border-[var(--color-primary)] bg-[var(--color-surface)] px-4 py-3 transition hover:bg-[var(--color-surface-raised)]"
        >
          <div>
            <p className="font-mono text-sm text-[var(--color-text)]">
              {invitations.length === 1
                ? `you have a pending invitation to ${invitations[0]?.projectName ?? 'a project'}.`
                : `you have ${invitations.length} pending invitations.`}
            </p>
            <p className="mt-0.5 font-mono text-xs text-[var(--color-text-muted)]">
              click to review and accept.
            </p>
          </div>
          <span className="font-mono text-sm text-[var(--color-primary)]">→</span>
        </Link>
      ) : null}

      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-mono text-xl tracking-tight">projects</h1>
          <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
            {projects.length === 0
              ? 'no projects yet. create one to get started.'
              : `${projects.length} project${projects.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <Link
          href="/dashboard/projects/new"
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
        >
          new project
        </Link>
      </header>

      {projects.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--color-border)] p-10 text-center">
          <p className="font-mono text-sm text-[var(--color-text-muted)]">
            projects are the unit of isolation on briven — one postgres schema, one function
            runtime, one set of deploy keys.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/dashboard/projects/${p.id}`}
                className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 transition hover:border-[var(--color-border)]"
              >
                <div>
                  <p className="font-mono text-sm">{p.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                    {p.slug} · {p.region} · {p.tier}
                  </p>
                </div>
                <span className="font-mono text-xs text-[var(--color-text-subtle)]">
                  {new Date(p.createdAt).toISOString().slice(0, 10)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
