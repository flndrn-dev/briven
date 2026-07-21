import { AuthKeysClient } from './keys-client';
import { loadAuthV2Workspace } from '../lib/load-workspace';

export const metadata = { title: 'Briven Auth · keys' };
export const dynamic = 'force-dynamic';

export default async function AuthKeysPage() {
  const projects = await loadAuthV2Workspace();

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">keys</h2>
        <p className="mt-1 max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          mint a public browser key (<code className="text-[var(--color-text)]">pk_briven_auth_…</code>
          ). never put a secret deploy key (<code className="text-[var(--color-text)]">brk_</code>) in
          the browser.
        </p>
      </header>
      <AuthKeysClient projects={projects} />
    </section>
  );
}
