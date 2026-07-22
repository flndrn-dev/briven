import { AuthSecurityClient } from './security-client';
import { loadAuthV2Workspace } from '../lib/load-workspace';

export const metadata = { title: 'Briven Auth · security' };
export const dynamic = 'force-dynamic';

export default async function AuthSecurityPage() {
  const projects = await loadAuthV2Workspace();

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">security</h2>
        <p className="mt-1 max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          two-factor login (with 10 backup recovery codes) and password rules. saves re-read from
          the live project so you can trust they stuck.
        </p>
      </header>
      <AuthSecurityClient projects={projects} />
    </section>
  );
}
