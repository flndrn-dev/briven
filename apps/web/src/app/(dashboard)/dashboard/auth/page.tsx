export const metadata = { title: 'Briven Auth' };
export const dynamic = 'force-dynamic';

/**
 * Blank slate home for Auth v2 (Option B).
 * Old Better Auth project UI is retired; engine rebuild uses SuperTokens
 * knowledge-base.md as the recipe library.
 */
export default function BrivenAuthHomePage() {
  return (
    <section className="flex flex-col gap-6">
      <div
        className="rounded-md border p-6 md:p-8"
        style={{
          borderColor: 'var(--auth-accent-border, var(--color-border))',
          background: 'var(--color-surface-raised)',
        }}
      >
        <p
          className="font-mono text-xs uppercase tracking-widest"
          style={{ color: 'var(--auth-accent, #e6b800)' }}
        >
          blank page · rebuild in progress
        </p>
        <h2 className="mt-3 font-mono text-base text-[var(--color-text)]">
          new Briven Auth is being built from scratch
        </h2>
        <p className="mt-3 max-w-2xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          the old login setup screens inside each project are closed on purpose.
          this yellow area is the new home for authentication — like a full
          login product inside Briven, powered by Briven Doltgres, taking the
          good parts from SuperTokens (sessions, passwordless, social, MFA…).
        </p>
        <ul className="mt-5 flex flex-col gap-2 font-mono text-xs text-[var(--color-text-muted)]">
          <li>1. enable Auth on a project (connects that project’s database)</li>
          <li>2. configure methods, users, sessions, keys here</li>
          <li>3. wire apps with one shared handoff when this page says ready</li>
        </ul>
        <p className="mt-6 font-mono text-[10px] text-[var(--color-text-muted)]">
          agents: see <code className="text-[var(--color-text)]">HANDOFF-BRIVEN-AUTH-V2.md</code>{' '}
          and <code className="text-[var(--color-text)]">knowledge-base.md</code>. do not invent
          Clerk.
        </p>
      </div>
    </section>
  );
}
