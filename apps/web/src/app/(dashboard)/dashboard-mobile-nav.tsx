'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Mobile-only horizontal nav strip. Mirrors the four (or five) sidebar
 * links — projects / teams / billing / settings (+ admin). Renders
 * below the dashboard header and is hidden md+ where the sidebar
 * takes over. Lives as a separate component so the icon-bearing
 * sidebar doesn't need to grow a responsive branch.
 */
const NAV = [
  { href: '/dashboard', label: 'overview' },
  { href: '/dashboard/projects', label: 'projects' },
  { href: '/dashboard/teams', label: 'teams' },
  { href: '/dashboard/billing', label: 'billing' },
  { href: '/dashboard/settings', label: 'settings' },
] as const;

// No 'admin' item here: the single admin entry is the avatar-dropdown row
// pointing at admin.briven.tech (the only admin address).
export function DashboardMobileNav() {
  const pathname = usePathname();
  const items = NAV;
  return (
    <nav
      aria-label="dashboard sections"
      className="flex gap-1 overflow-x-auto border-b border-[var(--color-border-subtle)] px-4 py-2 md:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        // overview matches exactly — every other tab matches by prefix.
        const active =
          item.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
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
