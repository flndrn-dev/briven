import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * Old project-scoped Auth UI removed. Point to blank Auth product page.
 */
export default async function AuthLayout({
  children: _children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  void _children;
  await params;
  return (
    <section className="flex flex-col gap-6 py-4">
      <div className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8">
        <h1 className="font-mono text-xl tracking-tight text-[var(--color-text)]">
          Auth
        </h1>
        <p className="mt-2 max-w-md font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          nothing here yet. Auth lives in the main sidebar — blank while the
          product is set up.
        </p>
        <Link
          href="/dashboard/auth"
          className="mt-5 inline-flex rounded-md px-4 py-2 font-mono text-xs font-medium text-black"
          style={{ background: '#FFFD74' }}
        >
          open Auth →
        </Link>
      </div>
    </section>
  );
}
