/** Simple empty state for Auth tabs that are not filled in yet. */

export function AuthRebuildBlank({ title }: { title: string }) {
  return (
    <section className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
      <h2 className="font-sans text-base font-medium text-[var(--color-text)]">
        {title}
      </h2>
      <p className="mt-2 max-w-md font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
        nothing here yet. check back after setup, or use another Auth tab.
      </p>
    </section>
  );
}
