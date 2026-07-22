import { AuthEnterpriseClient } from './enterprise-client';
import { loadAuthV2Workspace } from '../lib/load-workspace';

export const metadata = { title: 'Briven Auth · enterprise' };
export const dynamic = 'force-dynamic';

export default async function AuthEnterprisePage() {
  const projects = await loadAuthV2Workspace();
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">enterprise SSO</h2>
        <p className="mt-1 max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          company login (SAML / OIDC). each connection is tracked for billing. SCIM user sync is
          available on the API for IdP provisioning.
        </p>
      </header>
      <AuthEnterpriseClient projects={projects} />
    </section>
  );
}
