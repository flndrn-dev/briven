import { AuthBrandingClient } from '../../branding/branding-client';
import { loadAuthV2Workspace } from '../../lib/load-workspace';

export const metadata = { title: 'Auth · branding' };
export const dynamic = 'force-dynamic';

/**
 * Per-project login email look (briven-engine branding secrets).
 */
export default async function AuthProjectBrandingPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const projects = await loadAuthV2Workspace();
  const project = projects.find((p) => p.id === projectId);
  const list = project ? [project] : [];

  return (
    <section>
      <header className="mb-6">
        <h2 className="font-mono text-lg tracking-tight text-[var(--color-text)]">
          branding
        </h2>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          how sign-in emails look for this project only
        </p>
      </header>
      <AuthBrandingClient
        projects={list.length ? list : projects}
        lockProjectId={projectId}
        engineMode
      />
    </section>
  );
}
