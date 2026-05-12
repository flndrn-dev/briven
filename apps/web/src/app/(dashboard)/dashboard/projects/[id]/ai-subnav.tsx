'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const AI_TABS = [
  { suffix: '/ai-schema', label: 'schema' },
  { suffix: '/ai-function', label: 'function' },
  { suffix: '/ai-explain', label: 'explain' },
] as const;

/**
 * Sub-nav for the three AI features under one `ai` project tab.
 * Renders inline above each ai-* page; the parent tab nav stays
 * collapsed to a single `ai` entry so we don't pollute it.
 */
export function AiSubnav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/projects/${projectId}`;
  return (
    <nav
      aria-label="ai sections"
      className="flex gap-1 border-b border-[var(--color-border-subtle)] pb-2 font-mono text-xs"
    >
      {AI_TABS.map((tab) => {
        const href = `${base}${tab.suffix}`;
        const active = pathname.startsWith(href);
        return (
          <Link
            key={tab.suffix}
            href={href}
            className={`rounded-md px-3 py-1.5 transition ${
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
