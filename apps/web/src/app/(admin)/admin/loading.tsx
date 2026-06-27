/**
 * Cockpit-wide loading fallback. Shown while an admin page's server-side
 * /v1/admin/* fetch is in flight, so the operator sees a calm, honest
 * "working" state instead of a blank frame. Server-safe (no client hooks).
 *
 * Deliberately generic — a heading shimmer plus a small grid of card
 * skeletons — because it backs every cockpit page (overview, billing,
 * health, mcp), each of which leads with a header and a card row.
 */
export default function AdminCockpitLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">loading…</span>
      <header className="flex flex-col gap-2">
        <div className="h-6 w-48 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-surface)]" />
        <div className="h-4 w-full max-w-prose animate-pulse rounded-[var(--radius-md)] bg-[var(--color-surface)]" />
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)]"
          />
        ))}
      </div>
    </div>
  );
}
