'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Tabs for one Auth project — same pattern as project-tabs:
 * clean set by default; advanced tools behind “developer mode”.
 */
const TABS = [
  { href: '', label: 'overview', exact: true, dev: false },
  { href: '/users', label: 'users', dev: false },
  { href: '/sessions', label: 'sessions', dev: false },
  { href: '/security', label: 'security', dev: false },
  { href: '/keys', label: 'keys', dev: false },
  { href: '/providers', label: 'providers', dev: false },
  { href: '/branding', label: 'branding', dev: false },
  // Advanced / later tools
  { href: '/idp', label: 'IdP', dev: true },
  { href: '/migration', label: 'import', dev: true },
  { href: '/ai', label: 'AI', dev: true },
  { href: '/enterprise', label: 'enterprise', dev: true },
] as const;

const AUTH_ACCENT = '#FFFD74';
const COOKIE = 'briven_auth_project_dev';

export function AuthProjectNav({
  projectId,
  developerMode,
}: {
  projectId: string;
  developerMode: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/dashboard/auth/${projectId}`;
  const visible = TABS.filter((tab) => developerMode || !tab.dev);

  // If user lands on a hidden dev tab while mode is off, still show that tab
  // so they aren’t stranded.
  const forceShow = TABS.filter(
    (tab) =>
      tab.dev &&
      !visible.includes(tab) &&
      (pathname === `${base}${tab.href}` ||
        pathname.startsWith(`${base}${tab.href}/`)),
  );
  const tabs = [...visible, ...forceShow];

  function toggleDev() {
    const on = document.cookie
      .split('; ')
      .some((c) => c === `${COOKIE}=1`);
    document.cookie = `${COOKIE}=${on ? '0' : '1'}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)]">
      <nav
        aria-label="Auth project sections"
        className="flex flex-1 gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => {
          const href = `${base}${tab.href}`;
          const exact = 'exact' in tab && tab.exact === true;
          const active = exact
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
      <button
        type="button"
        onClick={toggleDev}
        title={
          developerMode
            ? 'Hide advanced Auth tools'
            : 'Show advanced tools (IdP, import, AI, enterprise…)'
        }
        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 font-mono text-xs transition"
        style={
          developerMode
            ? { background: AUTH_ACCENT, color: '#111' }
            : {
                color: `color-mix(in srgb, ${AUTH_ACCENT} 65%, transparent)`,
              }
        }
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-3.5"
        >
          <path d="M7 17 17 7M7 7h10v10" />
        </svg>
        developer mode
      </button>
    </div>
  );
}
