import { AuthBrandingClient } from './branding-client';
import { loadAuthV2Workspace } from '../lib/load-workspace';

export const metadata = { title: 'Briven Auth · branding' };
export const dynamic = 'force-dynamic';

export default async function AuthBrandingPage() {
  const projects = await loadAuthV2Workspace();
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">branding</h2>
        <p className="mt-1 max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          logo, accent color, and the name shown on login emails for each project.
        </p>
      </header>
      <AuthBrandingClient projects={projects} />
    </section>
  );
}
