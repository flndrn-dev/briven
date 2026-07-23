import { loadAuthV2Workspace } from '../../lib/load-workspace';
import { AuthEnterpriseClient } from '../../enterprise/enterprise-client';

export const metadata = { title: 'Auth · enterprise' };
export const dynamic = 'force-dynamic';

export default async function AuthProjectEnterprisePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const projects = await loadAuthV2Workspace();
  const project = projects.find((p) => p.id === projectId);
  const list = project ? [project] : projects;

  return (
    <section>
      <header className="mb-6">
        <h2 className="font-mono text-lg tracking-tight text-[var(--color-text)]">
          enterprise
        </h2>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          SAML / OIDC SSO for this project
        </p>
      </header>
      <AuthEnterpriseClient projects={list} lockProjectId={projectId} />
    </section>
  );
}
