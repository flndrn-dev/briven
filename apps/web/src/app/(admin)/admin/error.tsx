'use client';

import { useEffect } from 'react';

import { TriangleAlertIcon } from '@/components/ui/triangle-alert';

/**
 * Cockpit-wide error boundary. Any data-fetching admin page that throws
 * (e.g. an /v1/admin/* call fails) lands here instead of a blank crash —
 * a calm, themed note plus a retry, never a stack trace or fabricated
 * data. Covers overview, billing, health, and mcp in one place.
 *
 * Must be a Client Component (Next.js error boundary contract).
 */
export default function AdminCockpitError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the browser console for the operator; no PII rendered.
    console.error('[cockpit] page error:', error);
  }, [error]);

  return (
    <section
      role="alert"
      className="flex flex-col items-start gap-4 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6"
    >
      <div className="flex items-center gap-2">
        <span className="text-[var(--color-warning)]">
          <TriangleAlertIcon size={20} />
        </span>
        <h1 className="font-mono text-lg tracking-tight text-[var(--color-text)]">
          this view couldn&apos;t load
        </h1>
      </div>
      <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
        the cockpit reached the api but didn&apos;t get an answer it could trust — so it&apos;s
        showing nothing rather than a fake number. this is usually a transient blip; try again.
      </p>
      {error.digest ? (
        <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
          reference: {error.digest}
        </p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
      >
        try again
      </button>
    </section>
  );
}
