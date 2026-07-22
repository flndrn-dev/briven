/** Shared “phase not live yet” panel for Auth tabs during SuperTokens rebuild. */
export function AuthRebuildBlank({ phase, title }: { phase: string; title: string }) {
  return (
    <section
      className="rounded-md border p-6"
      style={{
        borderColor: 'var(--auth-accent-border, var(--color-border))',
        background: 'var(--color-surface-raised)',
      }}
    >
      <p
        className="font-mono text-[10px] uppercase tracking-widest"
        style={{ color: 'var(--auth-accent, #e6b800)' }}
      >
        rebuild · {phase} · not available yet
      </p>
      <h2 className="mt-2 font-mono text-sm text-[var(--color-text)]">{title}</h2>
      <p className="mt-2 max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
        Briven Auth is being rebuilt from zero on briven-engine. this tab is intentionally
        blank until its phase is built, live-tested, and you say OK. (no deploy until the
        full product is ready.)
      </p>
    </section>
  );
}
