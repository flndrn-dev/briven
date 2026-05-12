import Link from 'next/link';

import { DocsShell } from '../components/shell';

export const metadata = { title: 'not found' };

export default function NotFound() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">404 · not found</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        the docs page you tried to reach doesn&apos;t exist (or moved). try the sidebar, or
        the most-visited starting points below.
      </p>

      <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[
          { href: '/quickstart', label: 'quickstart' },
          { href: '/schema', label: 'schema dsl' },
          { href: '/examples', label: 'examples' },
          { href: '/api', label: 'http api' },
          { href: '/migration', label: 'migration guides' },
          { href: '/cli', label: 'cli reference' },
          { href: '/changelog', label: 'changelog' },
          { href: '/status', label: 'status' },
        ].map((p) => (
          <li key={p.href}>
            <Link
              href={p.href}
              className="block rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 font-mono text-sm hover:border-[var(--color-border)]"
            >
              {p.label}
            </Link>
          </li>
        ))}
      </ul>
    </DocsShell>
  );
}
