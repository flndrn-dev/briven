import { AuthUsersClient } from './users-client';
import { loadAuthV2Workspace } from '../lib/load-workspace';

export const metadata = { title: 'Briven Auth · users' };
export const dynamic = 'force-dynamic';

export default async function AuthUsersPage() {
  const projects = await loadAuthV2Workspace();

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">users</h2>
        <p className="mt-1 max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          end-users for each project (emails hidden). open a row for linked logins (Google + GitHub
          on one account), known devices, and live sessions.
        </p>
      </header>
      <AuthUsersClient projects={projects} />
    </section>
  );
}
