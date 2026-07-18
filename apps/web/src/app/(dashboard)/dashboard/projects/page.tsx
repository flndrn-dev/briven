import Link from 'next/link';

import { apiJson } from '../../../../lib/api';
import { ProjectsList } from './projects-list';

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

interface PendingOrgInvitation {
  id: string;
  orgId: string;
  orgName: string;
}

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  // Fetch projects + pending invites in parallel. Invites failure is
  // non-fatal — the banner just doesn't render — so we swallow the error
  // here rather than blocking the projects view.
  const [data, invitesResult, orgInvitesResult] = await Promise.all([
    apiJson<{ projects: Project[] }>('/v1/projects'),
    apiJson<{ invitations: PendingInvitation[] }>('/v1/me/invitations').catch(() => ({
      invitations: [] as PendingInvitation[],
    })),
    apiJson<{ invitations: PendingOrgInvitation[] }>('/v1/me/org-invitations').catch(() => ({
      invitations: [] as PendingOrgInvitation[],
    })),
  ]);
  const projects = data.projects;
  const invitations = invitesResult.invitations;
  const orgInvitations = orgInvitesResult.invitations;

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

      {orgInvitations.length > 0 ? (
        <Link
          href="/dashboard/teams"
          className="mb-6 flex items-center justify-between rounded-md border border-[var(--color-primary)] bg-[var(--color-surface)] px-4 py-3 transition hover:bg-[var(--color-surface-raised)]"
        >
          <div>
            <p className="font-mono text-sm text-[var(--color-text)]">
              {orgInvitations.length === 1
                ? `you have a pending invitation to join ${orgInvitations[0]?.orgName ?? 'a team'}.`
                : `you have ${orgInvitations.length} pending team invitations.`}
            </p>
            <p className="mt-0.5 font-mono text-xs text-[var(--color-text-muted)]">
              open the link in the email to accept.
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
                <p className="text-[var(--color-text)]">2 · build the schema · two paths</p>
                <p className="mt-1 text-[var(--color-text-muted)]">
                  <strong>dashboard</strong> — open the new project&apos;s <em>studio</em> tab,
                  click <em>+ new table</em>, define columns, set PKs/FKs/indexes. ideal for
                  prototyping and small one-off changes.
                </p>
                <p className="mt-2 text-[var(--color-text-muted)]">
                  <strong>cli + git</strong> — one command (Convex-style): sign in, create or
                  attach a project, wire this folder:
                </p>
                <pre className="mt-1 overflow-x-auto rounded-sm border border-[var(--color-border-subtle)] bg-[var(--color-code-bg)] px-3 py-2 text-[var(--color-code-text)]">
                  <code>{`mkdir my-app && cd my-app
npx @briven/cli setup --name my-app
# or: briven setup --project p_…   (existing)
briven deploy`}</code>
                </pre>
                <p className="mt-1 text-[var(--color-text-muted)]">
                  interactive: <code>briven setup</code> asks new vs existing. optional
                  starter files: <code>--template todo-app|chat|blank</code> (templates are
                  not the product). studio has <em>copy as schema.ts</em> to graduate to git.
                </p>
                <details className="mt-2 text-[10px] text-[var(--color-text-subtle)]">
                  <summary className="cursor-pointer">manual key path (no browser OAuth)</summary>
                  <pre className="mt-1 overflow-x-auto rounded-sm border border-[var(--color-border-subtle)] bg-[var(--color-code-bg)] px-3 py-2 text-[var(--color-code-text)]">
                    <code>
                      {`npx @briven/cli init --template todo-app
briven login --project <p_id> --key <brk_key>
briven link
briven deploy`}
                    </code>
                  </pre>
                </details>
                <details className="mt-2 text-[10px] text-[var(--color-text-subtle)]">
                  <summary className="cursor-pointer">offline install (curl, no npm)</summary>
                  <pre className="mt-1 overflow-x-auto rounded-sm border border-[var(--color-border-subtle)] bg-[var(--color-code-bg)] px-3 py-2 text-[var(--color-code-text)]">
                    <code>{`curl -fsSL https://briven.tech/install | sh
cd my-app && briven setup`}</code>
                  </pre>
                </details>
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
        <ProjectsList
          projects={projects}
          apiOrigin={process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? ''}
        />
      )}
    </section>
  );
}
