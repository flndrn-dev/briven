import { AuthIdpClientsClient } from '../../idp/idp-clients-client';
import { loadAuthV2Workspace } from '../../lib/load-workspace';

export const metadata = { title: 'Auth · IdP clients' };
export const dynamic = 'force-dynamic';

export default async function AuthProjectIdpPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const projects = await loadAuthV2Workspace();
  const project = projects.find((p) => p.id === projectId);
  const list = project ? [project] : projects.filter((p) => p.id === projectId);

  return (
    <section>
      <header className="mb-6">
        <h2 className="font-mono text-lg tracking-tight text-[var(--color-text)]">
          IdP clients
        </h2>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          apps that use this project as their login office (OpenID Connect)
        </p>
      </header>
      <AuthIdpClientsClient
        projects={list.length ? list : projects}
        lockProjectId={projectId}
      />
    </section>
  );
}
