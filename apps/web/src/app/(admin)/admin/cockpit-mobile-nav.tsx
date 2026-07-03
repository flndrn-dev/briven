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
type NavEntry =
  | { kind: 'label'; text: string }
  | { kind: 'link'; href: string; label: string; exact?: boolean };

// Mirrors CockpitNav's grouping. Group titles render as small inline
// dividers between the links so the strip stays scannable on phones.
const NAV: readonly NavEntry[] = [
  { kind: 'link', href: '/admin', label: 'overview', exact: true },
  { kind: 'label', text: 'money' },
  { kind: 'link', href: '/admin/billing', label: 'subscribers & billing' },
  { kind: 'label', text: 'customers' },
  { kind: 'link', href: '/admin/users', label: 'users' },
  { kind: 'link', href: '/admin/projects', label: 'projects' },
  { kind: 'label', text: 'agents' },
  { kind: 'link', href: '/admin/mcp', label: 'mcp / agent access' },
  { kind: 'link', href: '/admin/agents', label: 'ai agents' },
  { kind: 'label', text: 'platform' },
  { kind: 'link', href: '/admin/health', label: 'platform health' },
  { kind: 'link', href: '/admin/realtime', label: 'realtime' },
  { kind: 'link', href: '/admin/storage', label: 'storage' },
  { kind: 'link', href: '/admin/deploys', label: 'deploys' },
  { kind: 'label', text: 'operations' },
  { kind: 'link', href: '/admin/incidents', label: 'incidents' },
  { kind: 'link', href: '/admin/abuse-reports', label: 'abuse & allowlist' },
  { kind: 'link', href: '/admin/migrations', label: 'migrations' },
  { kind: 'link', href: '/admin/tickets', label: 'tickets' },
  { kind: 'link', href: '/admin/email-events', label: 'email' },
  { kind: 'label', text: 'system' },
  { kind: 'link', href: '/admin/launch', label: 'launch controls' },
  { kind: 'link', href: '/admin/settings', label: 'settings' },
] as const;

export function CockpitMobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="admin sections"
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--color-border-subtle)] px-4 py-2 md:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {NAV.map((item) => {
        if (item.kind === 'label') {
          return (
            <span
              key={`label-${item.text}`}
              className="shrink-0 whitespace-nowrap pl-2 pr-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]"
            >
              {item.text}
            </span>
          );
        }
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
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
