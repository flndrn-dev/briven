import Link from 'next/link';

import { AuthProjectsGrid } from './auth-projects-grid';
import { fetchAuthDashboard } from './lib/auth-api';
import { loadAuthV2Workspace } from './lib/load-workspace';

export const metadata = { title: 'Auth' };
export const dynamic = 'force-dynamic';

/**
 * Auth landing — same shape as /dashboard/projects:
 * title + count, optional stats strip, project card grid.
 */
export default async function BrivenAuthHomePage() {
  const [projects, dash] = await Promise.all([
    loadAuthV2Workspace(),
    fetchAuthDashboard(),
  ]);

  const enabledCount = projects.filter((p) => p.authEnabled).length;
  const users = dash.ok ? dash.data.counts.users : null;
  const sessions = dash.ok ? dash.data.counts.sessions : null;

  return (
    <section>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-mono text-xl tracking-tight text-[var(--color-text)]">
            Auth
          </h1>
          <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
            {projects.length === 0
              ? 'no projects yet. create one, then turn Auth on.'
              : `${enabledCount} of ${projects.length} project${projects.length === 1 ? '' : 's'} with Auth on`}
          </p>
        </div>
        <Link
          href="/dashboard/auth/keys"
          className="rounded-md px-4 py-2 font-mono text-sm font-medium text-black transition"
          style={{ background: 'var(--auth-accent, #FFFD74)' }}
        >
          keys
        </Link>
      </header>

      {(users != null || sessions != null) && (
        <ul className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile
            label="users"
            value={users == null ? '—' : String(users)}
            highlight
          />
          <StatTile
            label="sessions"
            value={sessions == null ? '—' : String(sessions)}
          />
          <StatTile label="Auth on" value={String(enabledCount)} />
        </ul>
      )}

      <AuthProjectsGrid projects={projects} />
    </section>
  );
}

function StatTile({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <li className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        {label}
      </p>
      <p
        className="mt-2 font-sans text-2xl font-medium tracking-tight text-[var(--color-text)]"
        style={
          highlight ? { color: 'var(--auth-accent, #FFFD74)' } : undefined
        }
      >
        {value}
      </p>
    </li>
  );
}
