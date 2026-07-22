export const metadata = { title: 'Auth · branding' };
export const dynamic = 'force-dynamic';

/**
 * Branding — colours and logo for hosted sign-in screens.
 */
export default function BrandingPage() {
  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-sans text-2xl font-medium tracking-[-0.02em] text-[var(--color-text)]">
          branding
        </h1>
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          how sign-in looks for your users
        </p>
      </header>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <p className="font-mono text-sm text-[var(--color-text)]">
          colours and logo coming next
        </p>
        <p className="mt-2 max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          Soon you can pick colours, a logo, and text for the ready-made sign-in
          screens. Default accent stays yellow so Auth still feels like Briven.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div
            className="h-12 w-12 rounded-md"
            style={{ background: 'var(--auth-accent, #e6b800)' }}
            title="accent"
          />
          <p className="font-mono text-xs text-[var(--color-text-muted)]">
            default accent
          </p>
        </div>
      </div>
    </section>
  );
}
