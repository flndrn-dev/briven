'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '', label: 'overview' },
  { href: '/functions', label: 'functions' },
  { href: '/logs', label: 'logs' },
  { href: '/deployments', label: 'deployments' },
  { href: '/studio', label: 'studio' },
  { href: '/connect', label: 'connect' },
  { href: '/env', label: 'env' },
  { href: '/keys', label: 'api keys' },
  { href: '/members', label: 'members' },
  { href: '/ai-schema', label: 'ai schema' },
  { href: '/ai-function', label: 'ai function' },
  { href: '/ai-explain', label: 'ai explain' },
  { href: '/activity', label: 'activity' },
  { href: '/settings', label: 'settings' },
] as const;

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/projects/${projectId}`;

  return (
    <nav
      aria-label="project sections"
      // 14 tabs at full width — at 640px the row overflows. Horizontal
      // scroll (with the scrollbar hidden on iOS/macOS native) keeps the
      // row appearance on desktop and gives mobile a thumb-swipe pattern
      // that doesn't require collapsing to a drawer.
      className="flex gap-1 overflow-x-auto border-b border-[var(--color-border-subtle)] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((tab) => {
        const href = `${base}${tab.href}`;
        const active = tab.href === '' ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={tab.href}
            href={href}
            className={`relative shrink-0 whitespace-nowrap px-3 py-2 font-mono text-sm transition ${
              active
                ? 'text-[var(--color-text)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {tab.label}
            {active ? (
              <span
                aria-hidden
                className="absolute inset-x-3 -bottom-px h-px bg-[var(--color-primary)]"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
