'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Mobile-only horizontal nav strip for the cockpit. Mirrors the desktop
 * CockpitNav links so sections stay reachable on phones (the sidebar is
 * hidden below md). Renders under the cockpit header and disappears at md+
 * where the sidebar takes over — same pattern as the customer dashboard's
 * DashboardMobileNav. Labels/hrefs mirror CockpitNav; icons are omitted
 * here since the strip is text-only by design.
 */
const NAV = [
  { href: '/admin', label: 'overview', exact: true },
  { href: '/admin/billing', label: 'subscribers & billing' },
  { href: '/admin/health', label: 'platform health' },
  { href: '/admin/mcp', label: 'mcp / agent access' },
  { href: '/dashboard/admin/projects', label: 'projects' },
  { href: '/dashboard/admin/users', label: 'users' },
  { href: '/dashboard/admin/storage', label: 'storage' },
  { href: '/dashboard/admin/deploys', label: 'deploys' },
  { href: '/dashboard/admin/incidents', label: 'incidents' },
  { href: '/dashboard/admin/abuse-reports', label: 'abuse & allowlist' },
  { href: '/dashboard/admin/email-events', label: 'email' },
  { href: '/dashboard/admin/migrations', label: 'migrations' },
  { href: '/admin/launch', label: 'launch controls' },
  { href: '/admin/settings', label: 'settings' },
] as const;

export function CockpitMobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="admin sections"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--color-border-subtle)] px-4 py-2 md:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {NAV.map((item) => {
        const active =
          'exact' in item && item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 font-mono text-xs transition ${
              active
                ? 'bg-[var(--color-surface-raised)] text-[var(--color-text)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
