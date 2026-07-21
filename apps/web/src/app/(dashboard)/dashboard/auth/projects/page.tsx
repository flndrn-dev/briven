import { AuthProjectsClient } from './projects-client';
import { loadAuthV2Workspace } from '../lib/load-workspace';

export const metadata = { title: 'Briven Auth · projects' };
export const dynamic = 'force-dynamic';

export default async function AuthProjectsPage() {
  const projects = await loadAuthV2Workspace();

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">projects</h2>
        <p className="mt-1 max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          every Briven project you can manage. turn Auth on here — that connects
          the project&apos;s own database to login. then configure methods under
          providers.
        </p>
      </header>
      <AuthProjectsClient initial={projects} />
    </section>
  );
}
