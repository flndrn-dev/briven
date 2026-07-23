import { fetchAuthCoreInfo } from '../lib/auth-api';
import { loadAuthV2Workspace } from '../lib/load-workspace';
import { AuthProvidersClient } from './providers-client';

export const metadata = { title: 'Auth · providers' };
export const dynamic = 'force-dynamic';

/**
 * Yellow Auth providers — social + core recipes status for a project.
 */
export default async function AuthProvidersPage() {
  const [projects, info] = await Promise.all([
    loadAuthV2Workspace(),
    fetchAuthCoreInfo(),
  ]);

  return (
    <section>
      <header className="mb-6">
        <h1 className="font-mono text-xl tracking-tight text-[var(--color-text)]">
          providers
        </h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          social login secrets and which methods are on for each project
        </p>
      </header>
      <AuthProvidersClient
        projects={projects}
        platformMethods={info?.loginMethods ?? []}
      />
    </section>
  );
}
