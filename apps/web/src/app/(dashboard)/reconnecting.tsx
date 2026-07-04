'use client';

import { useEffect, useState } from 'react';

/**
 * Shown when apps/api is briefly unreachable — almost always the ~1–2 minute
 * window while a deploy swaps containers. Instead of the hard "something
 * broke" 500 boundary, we show a calm "reconnecting…" and auto-reload until
 * the api answers again, at which point the dashboard renders normally.
 */
export function Reconnecting() {
  const [secs, setSecs] = useState(5);

  useEffect(() => {
    const tick = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    const reload = setTimeout(() => window.location.reload(), 5000);
    return () => {
      clearInterval(tick);
      clearTimeout(reload);
    };
  }, []);

  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-4 bg-[var(--color-bg)] px-6 text-center text-[var(--color-text)]">
      <div
        aria-hidden
        className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-primary)]"
      />
      <h1 className="font-mono text-lg">reconnecting…</h1>
      <p className="max-w-sm font-mono text-sm text-[var(--color-text-muted)]">
        briven is finishing a quick update. your data is safe — this page refreshes
        itself in {secs}s.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md border border-[var(--color-border)] px-4 py-2 font-mono text-xs text-[var(--color-text-muted)] transition hover:text-[var(--color-text)]"
      >
        retry now
      </button>
    </main>
  );
}
