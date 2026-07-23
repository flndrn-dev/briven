import { loadAuthV2Workspace } from '../lib/load-workspace';
import { AuthKeysClient } from './keys-client';

export const metadata = { title: 'Auth · keys' };
export const dynamic = 'force-dynamic';

/**
 * Yellow Auth keys — mint/list SDK keys (pk_briven_auth_…) per project.
 */
export default async function AuthKeysPage() {
  const projects = await loadAuthV2Workspace();

  return (
    <section>
      <header className="mb-6">
        <h1 className="font-mono text-xl tracking-tight text-[var(--color-text)]">
          keys
        </h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          SDK keys for your apps (shown once when created)
        </p>
      </header>
      <AuthKeysClient projects={projects} />
    </section>
  );
}
