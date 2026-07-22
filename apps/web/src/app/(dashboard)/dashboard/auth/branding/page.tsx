export const metadata = { title: 'Briven Auth · branding' };
export const dynamic = 'force-dynamic';

/**
 * Branding — prebuilt UI colours for briven-engine hosted sign-in (Phase 3/8).
 */
export default function BrandingPage() {
  return (
    <section className="flex flex-col gap-4">
      <p
        className="font-mono text-[10px] uppercase tracking-widest"
        style={{ color: 'var(--auth-accent, #e6b800)' }}
      >
        briven-engine · branding
      </p>
      <h2 className="font-mono text-sm text-[var(--color-text)]">
        How sign-in looks
      </h2>
      <p className="max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
        Later you will pick colours, logo, and text for the ready-made sign-in
        screens. Product name stays <strong className="text-[var(--color-text)]">Briven Auth</strong>{' '}
        / <strong className="text-[var(--color-text)]">briven-engine</strong> — never a third-party
        brand.
      </p>
      <div
        className="flex flex-wrap gap-3 rounded-md border p-4"
        style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
      >
        <div
          className="h-12 w-12 rounded-md"
          style={{ background: 'var(--auth-accent, #e6b800)' }}
          title="accent"
        />
        <div className="font-mono text-xs text-[var(--color-text-muted)]">
          default accent #e6b800
          <br />
          custom theme storage: next
        </div>
      </div>
    </section>
  );
}
