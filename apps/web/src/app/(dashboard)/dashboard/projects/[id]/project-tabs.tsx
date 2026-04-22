'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '', label: 'overview' },
  { href: '/functions', label: 'functions' },
  { href: '/deployments', label: 'deployments' },
  { href: '/env', label: 'env' },
  { href: '/keys', label: 'api keys' },
  { href: '/members', label: 'members' },
  { href: '/activity', label: 'activity' },
  { href: '/settings', label: 'settings' },
] as const;

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/projects/${projectId}`;

  return (
    <nav aria-label="project sections" className="flex gap-1 border-b border-[var(--color-border-subtle)]">
      {TABS.map((tab) => {
        const href = `${base}${tab.href}`;
        const active = tab.href === '' ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={tab.href}
            href={href}
            className={`relative px-3 py-2 font-mono text-sm transition ${
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
