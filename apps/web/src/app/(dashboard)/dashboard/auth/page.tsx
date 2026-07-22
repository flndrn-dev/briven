export const metadata = { title: 'Auth' };
export const dynamic = 'force-dynamic';

/**
 * Blank Auth product page — matches projects header language.
 * No feature UI until SuperTokens-on-Doltgres build is live-OK.
 */
export default function BrivenAuthBlankPage() {
  return (
    <section>
      <header className="mb-8">
        <h1 className="font-mono text-xl tracking-tight text-[var(--color-text)]">
          Auth
        </h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          sign-in for your apps
        </p>
      </header>

      <div className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8">
        <p className="font-mono text-sm text-[var(--color-text)]">
          nothing here yet
        </p>
        <p className="mt-2 max-w-md font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          Briven Auth is being set up as a clean product. This page will grow
          using the same dashboard design as projects and overview.
        </p>
      </div>
    </section>
  );
}
