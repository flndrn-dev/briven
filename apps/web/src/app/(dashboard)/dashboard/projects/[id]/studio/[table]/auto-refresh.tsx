'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * "live" toggle for the table view. While on, it quietly re-fetches the
 * page's server data every few seconds via router.refresh() (in-place
 * re-render, no full reload) so the grid stays current without a manual
 * refresh. Pausable so it won't interrupt an in-progress cell edit. Only
 * refreshes while the tab is visible.
 *
 * (Interim: true push-based realtime needs the engine reworked for Postgres;
 * this gives live-enough updates for the studio grid today.)
 */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [live, setLive] = useState(true);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [live, intervalMs, router]);

  return (
    <button
      type="button"
      onClick={() => setLive((v) => !v)}
      aria-pressed={live}
      title={
        live
          ? 'live — auto-refreshing every few seconds; click to pause'
          : 'paused — click to resume live updates'
      }
      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2.5 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-border)]"
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          live ? 'animate-pulse bg-[var(--color-primary)]' : 'bg-[var(--color-text-subtle)]'
        }`}
      />
      {live ? 'live' : 'paused'}
    </button>
  );
}
