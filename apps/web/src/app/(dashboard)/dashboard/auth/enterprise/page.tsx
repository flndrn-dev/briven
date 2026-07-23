import { loadAuthV2Workspace } from '../lib/load-workspace';
import { AuthEnterpriseClient } from './enterprise-client';

export const metadata = { title: 'Auth · enterprise' };
export const dynamic = 'force-dynamic';

/**
 * Yellow Auth enterprise — tenants / project map + honest SSO status.
 */
export default async function AuthEnterprisePage() {
  const projects = await loadAuthV2Workspace();

  return (
    <section>
      <header className="mb-6">
        <h1 className="font-mono text-xl tracking-tight text-[var(--color-text)]">
          enterprise
        </h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          projects → tenants on Doltgres · SSO login depth later
        </p>
      </header>
      <AuthEnterpriseClient projects={projects} />
    </section>
  );
}
