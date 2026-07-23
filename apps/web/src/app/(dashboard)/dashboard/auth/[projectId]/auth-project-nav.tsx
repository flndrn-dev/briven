'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: '', label: 'overview', exact: true },
  { href: '/users', label: 'users' },
  { href: '/sessions', label: 'sessions' },
  { href: '/security', label: 'security' },
  { href: '/keys', label: 'keys' },
  { href: '/providers', label: 'providers' },
  { href: '/enterprise', label: 'enterprise' },
];

/**
 * Tabs for one Auth project — same pattern as project tabs.
 * Selected tab = brighter text only (no thick accent underline).
 */
export function AuthProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/auth/${projectId}`;

  return (
    <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)]">
      <nav
        aria-label="Auth project sections"
        className="flex flex-1 gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((tab) => {
          const href = `${base}${tab.href}`;
          const active =
            tab.exact === true
              ? pathname === base || pathname === `${base}/`
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={tab.href || 'overview'}
              href={href}
              className={`shrink-0 whitespace-nowrap px-3 py-2 font-mono text-sm transition outline-none focus:outline-none focus-visible:outline-none ${
                active
                  ? 'font-medium text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <Link
        href="/dashboard/auth"
        className="shrink-0 whitespace-nowrap px-2 py-1 font-mono text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        ← all Auth
      </Link>
    </div>
  );
}
