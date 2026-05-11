import Link from 'next/link';

import { apiJson } from '../../../../lib/api';

interface Project {
  id: string;
  slug: string;
  name: string;
  region: string;
  tier: 'free' | 'pro' | 'team';
  createdAt: string;
  orgName: string | null;
  orgPersonal: boolean | null;
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
        <div className="rounded-md border border-dashed border-[var(--color-border)] p-8">
          <div className="flex flex-col gap-6">
            <div>
              <p className="font-mono text-sm text-[var(--color-text)]">
                welcome to briven.
              </p>
              <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
                a project is one postgres schema + one function runtime + one set of deploy
                keys. you&rsquo;ll usually have one per app you ship.
              </p>
            </div>

            <ol className="flex flex-col gap-4 font-mono text-xs">
              <li>
                <p className="text-[var(--color-text)]">1 · create your first project</p>
                <p className="mt-1 text-[var(--color-text-muted)]">
                  click <em>new project</em> above. takes ~3 seconds — postgres schema +
                  runtime spin up in the background.
                </p>
              </li>
              <li>
                <p className="text-[var(--color-text)]">2 · scaffold a local copy</p>
                <pre className="mt-1 overflow-x-auto rounded-sm border border-[var(--color-border-subtle)] bg-[var(--color-code-bg)] px-3 py-2 text-[var(--color-code-text)]">
                  <code>
                    {`pnpm dlx @briven/cli init my-app --template todo-app
cd my-app
briven login --project <p_id> --key <brk_key>
briven link
briven deploy`}
                  </code>
                </pre>
                <p className="mt-1 text-[var(--color-text-muted)]">
                  <code>--template todo-app</code> ships a working schema + 4 mutations + 1
                  reactive query. swap for <code>chat</code> or <code>blank</code>.
                </p>
              </li>
              <li>
                <p className="text-[var(--color-text)]">3 · invoke + iterate</p>
                <p className="mt-1 text-[var(--color-text-muted)]">
                  <code>briven invoke listTodos</code> to test from the cli, or wire{' '}
                  <code>@briven/react</code> /{' '}
                  <code>@briven/svelte</code> /{' '}
                  <code>@briven/vue</code> into your frontend. queries are reactive by
                  default — they re-run when the underlying rows change.
                </p>
              </li>
            </ol>

            <div className="flex flex-wrap gap-3 font-mono text-xs">
              <a
                href="https://docs.briven.tech/quickstart"
                className="underline underline-offset-2 hover:text-[var(--color-text)]"
              >
                full quickstart →
              </a>
              <a
                href="https://docs.briven.tech/cli"
                className="text-[var(--color-text-muted)] underline underline-offset-2 hover:text-[var(--color-text)]"
              >
                cli reference
              </a>
              <a
                href="https://docs.briven.tech/functions"
                className="text-[var(--color-text-muted)] underline underline-offset-2 hover:text-[var(--color-text)]"
              >
                functions
              </a>
            </div>
          </div>
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
                    {p.orgName ? (
                      <span>
                        {' · '}
                        <span className="text-[var(--color-text-muted)]">
                          {p.orgName}
                          {p.orgPersonal ? '' : ' (team)'}
                        </span>
                      </span>
                    ) : null}
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
