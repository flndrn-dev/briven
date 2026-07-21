import { AuthDomainsClient } from './domains-client';
import { loadAuthV2Workspace } from '../lib/load-workspace';

export const metadata = { title: 'Briven Auth · domains' };
export const dynamic = 'force-dynamic';

export default async function AuthDomainsPage() {
  const projects = await loadAuthV2Workspace();

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">domains</h2>
        <p className="mt-1 max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          allowed app website addresses. magic links and cookies need these so
          login opens on your site, not a bare API page.
        </p>
      </header>
      <AuthDomainsClient projects={projects} />
    </section>
  );
}
