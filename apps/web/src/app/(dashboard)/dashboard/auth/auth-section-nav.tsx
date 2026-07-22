'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Auth section tabs — same pattern as project tabs:
 * simple set by default; advanced tools behind “developer mode”.
 */
const TABS = [
  { href: '/dashboard/auth', label: 'overview', exact: true, dev: false },
  { href: '/dashboard/auth/projects', label: 'projects', dev: false },
  { href: '/dashboard/auth/users', label: 'users', dev: false },
  { href: '/dashboard/auth/sessions', label: 'sessions', dev: false },
  { href: '/dashboard/auth/keys', label: 'keys', dev: false },
  // Advanced / setup tools
  { href: '/dashboard/auth/providers', label: 'providers', dev: true },
  { href: '/dashboard/auth/security', label: 'security', dev: true },
  { href: '/dashboard/auth/branding', label: 'branding', dev: true },
  { href: '/dashboard/auth/enterprise', label: 'enterprise', dev: true },
  { href: '/dashboard/auth/domains', label: 'domains', dev: true },
] as const;

const AUTH_ACCENT = '#e6b800';
const COOKIE = 'briven_auth_dev';

function readDevCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((c) => c === `${COOKIE}=1`);
}

export function AuthSectionNav() {
  const pathname = usePathname();
  const router = useRouter();
  // Start false so first paint matches “simple” project-tabs default; cookie
  // applied after mount.
  const [devMode, setDevMode] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setDevMode(readDevCookie());
    setHydrated(true);
  }, []);

  function toggleDev() {
    const on = readDevCookie();
    document.cookie = `${COOKIE}=${on ? '0' : '1'}; path=/; max-age=31536000; samesite=lax`;
    setDevMode(!on);
    router.refresh();
  }

  const visible = TABS.filter((tab) => (hydrated ? devMode : false) || !tab.dev);

  // If user lands on a hidden dev tab while mode is off, still show that tab
  // so they aren’t stranded.
  const forceShow = TABS.filter(
    (tab) =>
      tab.dev &&
      !visible.includes(tab) &&
      (pathname === tab.href || pathname.startsWith(`${tab.href}/`)),
  );
  const tabs = [...visible, ...forceShow];

  return (
    <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)]">
      <nav
        aria-label="Auth sections"
        className="flex flex-1 gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => {
          const exact = 'exact' in tab && tab.exact === true;
          const active = exact
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
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
                  className="absolute inset-x-3 -bottom-px h-0.5 rounded-full"
                  style={{ background: AUTH_ACCENT }}
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
          devMode
            ? 'Hide advanced Auth tools'
            : 'Show advanced tools (providers, security, branding…)'
        }
        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 font-mono text-xs transition"
        style={
          devMode
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
