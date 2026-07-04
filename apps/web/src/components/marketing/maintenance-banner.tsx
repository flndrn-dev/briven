'use client';

import { useState } from 'react';

/**
 * Thin, dismissible pre-announcement strip. Rendered only when maintenance is
 * `upcoming` (scheduled but not started). Purely informational — no fetch, no
 * gated data; the parent server component decides whether to render it and
 * passes the pre-formatted window in. Dismiss state is local to the session.
 */
export function MaintenanceBanner({ window: label }: { window: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      role="status"
      className="relative z-40 flex items-center justify-center gap-3 border-b border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] px-4 py-2 text-center font-mono text-[var(--color-text)] text-[var(--text-xs)]"
    >
      <span>
        <span className="uppercase tracking-wider text-[var(--color-primary)]">
          scheduled maintenance:
        </span>{' '}
        {label}
      </span>
      <button
        type="button"
        aria-label="dismiss"
        onClick={() => setDismissed(true)}
        className="absolute right-3 text-[var(--color-text-subtle)] transition-colors hover:text-[var(--color-text)]"
      >
        ✕
      </button>
    </div>
  );
}
