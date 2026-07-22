export const metadata = { title: 'Briven Auth · projects' };
export const dynamic = 'force-dynamic';

/**
 * Projects — how Briven projects map to briven-engine tenants.
 */
export default function ProjectsPage() {
  return (
    <section className="flex flex-col gap-4">
      <p
        className="font-mono text-[10px] uppercase tracking-widest"
        style={{ color: 'var(--auth-accent, #e6b800)' }}
      >
        briven-engine · projects
      </p>
      <h2 className="font-mono text-sm text-[var(--color-text)]">
        One project = one login island
      </h2>
      <p className="max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
        Each Briven project gets its own briven-engine tenant (like a separate
        apartment in the same building). Users in project A cannot see users in
        project B.
      </p>
      <div
        className="rounded-md border p-4 font-mono text-xs text-[var(--color-text-muted)]"
        style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
      >
        Mapping rule:
        <br />
        <code className="text-[var(--color-text)]">
          projectId → tenantId = proj_&lt;projectId&gt;
        </code>
        <br />
        <br />
        API: <code className="text-[var(--color-text)]">GET /v1/auth-core/map/:projectId</code>
        <br />
        Ensure tenant:{' '}
        <code className="text-[var(--color-text)]">
          POST /v1/auth-core/projects/:projectId/tenant
        </code>
        <br />
        Config:{' '}
        <code className="text-[var(--color-text)]">
          GET /v1/auth-core/projects/:projectId/config
        </code>
      </div>
    </section>
  );
}
