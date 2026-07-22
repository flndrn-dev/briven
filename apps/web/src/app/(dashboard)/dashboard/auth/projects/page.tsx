export const metadata = { title: 'Auth · projects' };
export const dynamic = 'force-dynamic';

/**
 * Projects — each Briven project gets its own login island.
 */
export default function ProjectsPage() {
  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-sans text-2xl font-medium tracking-[-0.02em] text-[var(--color-text)]">
          projects
        </h1>
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          each project has its own sign-in island
        </p>
      </header>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <p className="font-mono text-sm text-[var(--color-text)]">
          one project = one login island
        </p>
        <p className="mt-2 max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          Users in project A cannot see users in project B — like separate
          apartments in the same building. Turn Auth on for a project from the
          project settings, then manage users, keys, and providers here.
        </p>
      </div>
    </section>
  );
}
