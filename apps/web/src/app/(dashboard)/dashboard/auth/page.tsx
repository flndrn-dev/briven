import { fetchAuthCoreInfo } from './lib/auth-api';
import { loadAuthV2Workspace } from './lib/load-workspace';
import { AuthProjectsGrid } from './auth-projects-grid';

export const metadata = { title: 'Auth' };
export const dynamic = 'force-dynamic';

/**
 * Auth home — pick a project (same idea as the Projects dashboard).
 * Click a card → that project's Auth only.
 */
export default async function AuthHomePage() {
  const [projects, info] = await Promise.all([
    loadAuthV2Workspace(),
    fetchAuthCoreInfo(),
  ]);

  const enabled = projects.filter((p) => p.authEnabled).length;
  const engine = info?.engine ?? 'briven-engine';
  const version = info?.engineVersion ?? '';

  return (
    <section>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-xl tracking-tight text-[var(--color-text)]">
            Auth
          </h1>
          <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
            {projects.length} project{projects.length === 1 ? '' : 's'}
            {enabled > 0 ? ` · ${enabled} Auth on` : ''}
            {version ? ` · ${engine} ${version}` : ''}
          </p>
        </div>
      </header>

      <p className="mb-4 max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
        Each card is one app&apos;s sign-in. Open a project to manage its users,
        sessions, keys, providers, and company SSO — nothing mixed between
        projects.
      </p>

      <AuthProjectsGrid projects={projects} />
    </section>
  );
}
