import { Suspense } from 'react';

import { loadAuthV2Workspace } from '../lib/load-workspace';
import { AuthBrandingClient } from './branding-client';

export const metadata = { title: 'Auth · branding' };
export const dynamic = 'force-dynamic';

/**
 * Global Auth branding picker — prefers project path when you open from a project.
 * Uses briven-engine branding (not the retired blank redirect).
 */
export default async function AuthBrandingPage() {
  const projects = await loadAuthV2Workspace();

  return (
    <section>
      <header className="mb-6">
        <h2 className="font-mono text-lg tracking-tight text-[var(--color-text)]">
          branding
        </h2>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          logo, accent color, and “from” name for login emails
        </p>
      </header>
      <Suspense
        fallback={
          <p className="font-mono text-xs text-[var(--color-text-muted)]">
            loading…
          </p>
        }
      >
        <AuthBrandingClient projects={projects} engineMode />
      </Suspense>
    </section>
  );
}
