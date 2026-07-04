'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

// Non-coders see a clean set of tabs by default. Developer-only surfaces
// (SQL editor, functions, webhooks, api keys, env, deployments, etc.) are
// hidden behind a "developer mode" toggle so the default experience stays
// simple. The toggle persists via a cookie read server-side in the layout.
const TABS = [
  { href: '', label: 'overview', dev: false },
  { href: '/studio', label: 'studio', dev: false },
  { href: '/snapshots', label: 'snapshots', dev: false },
  { href: '/auth', label: 'auth', dev: false },
  { href: '/storage', label: 'storage', dev: false },
  // Agent access (MCP keys) — always visible: agents are first-class users
  // of Briven, so the door to them can't hide behind developer mode.
  { href: '/mcp', label: 'mcp', dev: false },
  { href: '/members', label: 'members', dev: false },
  { href: '/functions', label: 'functions', dev: true },
  { href: '/cron', label: 'cron', dev: true },
  { href: '/webhooks', label: 'webhooks', dev: true },
  { href: '/logs', label: 'logs', dev: true },
  { href: '/deployments', label: 'deployments', dev: true },
  { href: '/connect', label: 'connect', dev: true },
  { href: '/env', label: 'env', dev: true },
  { href: '/keys', label: 'api keys', dev: true },
  { href: '/ai-schema', label: 'ai', match: '/ai-', dev: true },
  { href: '/settings', label: 'settings', dev: false },
] as const;

export function ProjectTabs({
  projectId,
  developerMode,
}: {
  projectId: string;
  developerMode: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/dashboard/projects/${projectId}`;
  const visible = TABS.filter((tab) => developerMode || !tab.dev);

  function toggleDev() {
    const on = document.cookie.split('; ').some((c) => c === 'briven_dev=1');
    document.cookie = `briven_dev=${on ? '0' : '1'}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)]">
      <nav
        aria-label="project sections"
        className="flex flex-1 gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {visible.map((tab) => {
          const href = `${base}${tab.href}`;
          const matchPrefix = 'match' in tab && tab.match ? `${base}${tab.match}` : href;
          const active = tab.href === '' ? pathname === base : pathname.startsWith(matchPrefix);
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
      <button
        type="button"
        onClick={toggleDev}
        title={
          developerMode
            ? 'Hide developer tools — show the simple view'
            : 'Show developer tools (SQL editor, functions, api keys, webhooks…)'
        }
        className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 font-mono text-xs transition ${
          developerMode
            ? 'bg-[var(--color-primary-subtle)] text-[var(--color-text)]'
            : 'text-[var(--color-text-subtle)] hover:text-[var(--color-text-muted)]'
        }`}
      >
        {developerMode ? '◆ developer mode' : '◇ developer mode'}
      </button>
    </div>
  );
}
