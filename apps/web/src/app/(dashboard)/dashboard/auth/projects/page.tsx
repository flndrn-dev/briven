import { AuthProjectsGrid } from '../auth-projects-grid';
import { loadAuthV2Workspace } from '../lib/load-workspace';

export const metadata = { title: 'Auth · projects' };
export const dynamic = 'force-dynamic';

/**
 * Auth projects — same card grid as the main Projects page.
 */
export default async function AuthProjectsPage() {
  const projects = await loadAuthV2Workspace();
  const enabledCount = projects.filter((p) => p.authEnabled).length;

  return (
    <section>
      <header className="mb-8">
        <h1 className="font-mono text-xl tracking-tight text-[var(--color-text)]">
          projects
        </h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          {projects.length === 0
            ? 'no projects yet.'
            : `${enabledCount} of ${projects.length} with Auth on · each project is its own login island`}
        </p>
      </header>

      <AuthProjectsGrid projects={projects} />
    </section>
  );
}
