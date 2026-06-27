'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Segment-level error boundary (500 / unexpected runtime errors). Rendered
 * inside the root layout, so globals.css + fonts apply. Uses a plain <img>
 * (not next/image) so the fallback stays robust even when something is broken.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // the real stack is captured server-side; surface the digest for support.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6 py-16 font-mono text-sm">
      <Link href="/" className="flex items-center gap-2" aria-label="briven home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" width={28} height={28} />
        <span>briven</span>
      </Link>

      <div>
        <h1 className="text-2xl tracking-tight">500 · something broke</h1>
        <p className="mt-2 text-[var(--color-text-muted)]">
          an unexpected error happened on our side. it&apos;s logged — give it another try, or head
          back home.
        </p>
        {error.digest ? (
          <p className="mt-2 text-[10px] text-[var(--color-text-subtle)]">reference: {error.digest}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 hover:border-[var(--color-border)]"
        >
          ↻ try again
        </button>
        <Link
          href="/"
          className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 hover:border-[var(--color-border)]"
        >
          go home →
        </Link>
        <Link
          href="https://docs.briven.tech/status"
          className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 hover:border-[var(--color-border)]"
        >
          check status →
        </Link>
      </div>

      <footer className="mt-auto pt-8 font-mono text-[10px] text-[var(--color-text-subtle)]">
        built with <span className="text-[#e8344a]">♥</span> in Flanders · flndrn
      </footer>
    </main>
  );
}
