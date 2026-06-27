/**
 * Shared "coming soon" stub for cockpit sections built in later phases.
 * Server-safe (no client hooks) — gated by the (admin) layout.
 */
export function CockpitPlaceholder({ title, blurb }: { title: string; blurb: string }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h1 className="font-mono text-xl tracking-tight">{title}</h1>
        <span className="inline-flex items-center rounded-[var(--radius-full)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          coming soon
        </span>
      </div>
      <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">{blurb}</p>
    </section>
  );
}
