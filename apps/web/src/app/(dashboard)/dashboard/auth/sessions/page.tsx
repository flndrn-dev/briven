import { AuthSessionsClient } from './sessions-client';
import { loadAuthV2Workspace } from '../lib/load-workspace';

export const metadata = { title: 'Briven Auth · sessions' };
export const dynamic = 'force-dynamic';

export default async function AuthSessionsPage() {
  const projects = await loadAuthV2Workspace();

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">sessions</h2>
        <p className="mt-1 max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          who signed in recently (last-seen per user). full device revoke lands
          in a later phase; for now open users for the list.
        </p>
      </header>
      <AuthSessionsClient projects={projects} />
    </section>
  );
}
