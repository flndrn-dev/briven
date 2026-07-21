import { Suspense } from 'react';

import { AuthProvidersClient } from './providers-client';
import { loadAuthV2Workspace } from '../lib/load-workspace';

export const metadata = { title: 'Briven Auth · providers' };
export const dynamic = 'force-dynamic';

export default async function AuthProvidersPage() {
  const projects = await loadAuthV2Workspace();

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">providers</h2>
        <p className="mt-1 max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          password, magic link, email code, passkeys. after you save, we re-read
          the live settings so you can see the save stuck.
        </p>
      </header>
      <Suspense
        fallback={
          <p className="font-mono text-xs text-[var(--color-text-muted)]">loading…</p>
        }
      >
        <AuthProvidersClient projects={projects} />
      </Suspense>
    </section>
  );
}
