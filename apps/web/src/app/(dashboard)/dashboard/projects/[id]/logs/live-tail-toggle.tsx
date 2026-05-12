'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Toggleable poll-driven auto-refresh for the logs page. When on, we
 * call router.refresh() every 5s so the server-rendered list re-fetches
 * with the same filters. Off by default — polling wastes a request per
 * tick and most users don't need it.
 *
 * Polling beats SSE here because the logs page is server-rendered and
 * already does the right query with cookies + filters; piggybacking on
 * router.refresh() keeps the surface area tiny.
 */
const INTERVAL_MS = 5000;

export function LiveTailToggle() {
  const router = useRouter();
  const [on, setOn] = useState(false);
  const [tickAt, setTickAt] = useState<number | null>(null);

  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => {
      router.refresh();
      setTickAt(Date.now());
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [on, router]);

  return (
    <label className="flex items-center gap-2 font-mono text-[10px] text-[var(--color-text-muted)]">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => setOn(e.target.checked)}
        className="accent-[var(--color-primary)]"
      />
      live tail
      {on ? (
        <span className="text-[var(--color-text-subtle)]">
          · {Math.round(INTERVAL_MS / 1000)}s
          {tickAt ? ` · last ${new Date(tickAt).toISOString().slice(11, 19)}` : ''}
        </span>
      ) : null}
    </label>
  );
}
