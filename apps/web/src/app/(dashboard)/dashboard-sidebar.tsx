'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import {
  ChevronIcon,
  FolderIcon,
  SettingsIcon,
  ShieldIcon,
} from '../../components/animated-icons';

const STORAGE_KEY = 'briven.sidebar.collapsed';

interface NavItem {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => ReactNode;
  /** Highlight when the current pathname starts with this prefix. */
  match: (pathname: string) => boolean;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  {
    href: '/dashboard/projects',
    label: 'projects',
    Icon: FolderIcon,
    match: (p) => p.startsWith('/dashboard/projects'),
  },
  {
    href: '/dashboard/settings',
    label: 'settings',
    Icon: SettingsIcon,
    match: (p) => p.startsWith('/dashboard/settings'),
  },
  {
    href: '/dashboard/admin',
    label: 'admin',
    Icon: ShieldIcon,
    match: (p) => p.startsWith('/dashboard/admin'),
    adminOnly: true,
  },
];

export function DashboardSidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  // Avoid hydration flicker: start collapsed=false on the server, then
  // sync from localStorage on mount.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === '1') setCollapsed(true);
    } catch {
      // private-mode / blocked storage — fine, default collapsed=false
    }
    setHydrated(true);
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }

  const items = NAV.filter((i) => !i.adminOnly || isAdmin);

  return (
    <nav
      aria-label="dashboard sections"
      data-collapsed={hydrated && collapsed ? 'true' : 'false'}
      className={`flex flex-col transition-[width] duration-200 ease-out ${
        hydrated && collapsed ? 'w-[60px]' : 'w-[180px]'
      }`}
    >
      <ul className="flex flex-1 flex-col gap-1">
        {items.map((item) => {
          const active = item.match(pathname);
          const { Icon } = item;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex items-center gap-3 rounded-md px-3 py-2 font-mono text-sm transition-colors ${
                  active
                    ? 'bg-[var(--color-surface)] text-[var(--color-primary)]'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-primary)]'
                }`}
              >
                <Icon className="inline-flex size-10 items-center justify-center" />
                {hydrated && collapsed ? (
                  <span className="sr-only">{item.label}</span>
                ) : (
                  <span className="truncate">{item.label}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? 'expand sidebar' : 'collapse sidebar'}
        className="mx-auto mb-2 mt-4 flex size-8 items-center justify-center rounded-md border border-[var(--color-border-subtle)] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border)] hover:text-[var(--color-primary)]"
      >
        <ChevronIcon
          className="size-4"
          direction={hydrated && collapsed ? 'right' : 'left'}
        />
      </button>
    </nav>
  );
}
