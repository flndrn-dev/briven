'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Props {
  projectId: string;
}

const TABS: Array<{ slug: string; label: string }> = [
  { slug: '', label: 'overview' },
  { slug: '/providers', label: 'providers' },
  { slug: '/branding', label: 'branding' },
  { slug: '/users', label: 'users' },
  { slug: '/audit', label: 'audit' },
  { slug: '/api-keys', label: 'api keys' },
  { slug: '/webhooks', label: 'webhooks' },
  { slug: '/usage', label: 'usage' },
];

/**
 * Sub-nav for the auth section. `usePathname` decides which tab is active.
 * A tab matches when the current path is either the tab's exact path or a
 * deeper sub-route of it (so `/auth/users/abc123` lights up the `users`
 * tab).
 */
export function AuthSubNav({ projectId }: Props) {
  const pathname = usePathname() ?? '';
  const base = `/dashboard/projects/${projectId}/auth`;

  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border-subtle)] pb-2">
      {TABS.map((tab) => {
        const href = `${base}${tab.slug}`;
        // Overview tab matches only when the path is exactly `/auth`. Other
        // tabs match when the path starts with `<base><slug>` AND the next
        // character is `/` or end-of-string — prevents `/auth/api-keys`
        // accidentally lighting up `/auth/api` (no such tab today, but
        // belt-and-braces).
        const active =
          tab.slug === ''
            ? pathname === base
            : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab.slug}
            href={href}
            className={`rounded-md px-3 py-1.5 font-mono text-xs ${
              active
                ? 'bg-[var(--color-surface-raised)] text-[var(--color-text)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
