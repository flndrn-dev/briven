export const metadata = { title: 'Auth · domains' };
export const dynamic = 'force-dynamic';

/**
 * Domains — which websites may use Auth for a project.
 */
export default function DomainsPage() {
  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-sans text-2xl font-medium tracking-[-0.02em] text-[var(--color-text)]">
          domains
        </h1>
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          which websites may use Auth for your project
        </p>
      </header>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <p className="font-mono text-sm text-[var(--color-text)]">
          app website + first-party proxy
        </p>
        <p className="mt-2 max-w-2xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          Login cookies must live on your app&apos;s website address — not only
          on Briven&apos;s API. Think of a reception desk inside your building:
          visitors check in at your door, and the desk quietly phones the vault
          in the back.
        </p>
        <ol className="mt-4 flex max-w-2xl list-decimal flex-col gap-2 pl-5 font-mono text-xs text-[var(--color-text-muted)]">
          <li>
            Your app exposes{' '}
            <code className="text-[var(--color-text)]">/api/auth/*</code>
          </li>
          <li>
            That path forwards to Briven Auth behind the scenes
          </li>
          <li>
            Your app SDK points at{' '}
            <code className="text-[var(--color-text)]">/api/auth</code>
          </li>
        </ol>
      </div>
    </section>
  );
}
