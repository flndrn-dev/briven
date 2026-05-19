import type { ReactNode } from 'react';

/**
 * Layout shared by every hosted-pages flow for a single tenant. Pulled
 * out of the dashboard's app-router group so the chrome is minimal —
 * dark theme, brand mark, no nav, single centred card. Live at
 * `<tenant>.auth.briven.tech/<flow>` (or `briven.tech/auth/<projectId>/<flow>`
 * before the subdomain routing lands).
 */
export default async function HostedAuthLayout({
  children,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[var(--color-bg)] px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <header className="flex items-center justify-center">
          <span className="font-mono text-lg tracking-tight text-[var(--color-text)]">
            briven
          </span>
        </header>
        {children}
        <footer className="text-center font-mono text-[10px] text-[var(--color-text-subtle)]">
          built with{' '}
          <span className="text-[var(--color-primary)]">♥</span> in flanders
        </footer>
      </div>
    </main>
  );
}
