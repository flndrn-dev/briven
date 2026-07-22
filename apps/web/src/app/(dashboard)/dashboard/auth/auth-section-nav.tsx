'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/dashboard/auth', label: 'overview', exact: true },
  { href: '/dashboard/auth/projects', label: 'projects' },
  { href: '/dashboard/auth/providers', label: 'providers' },
  { href: '/dashboard/auth/security', label: 'security' },
  { href: '/dashboard/auth/users', label: 'users' },
  { href: '/dashboard/auth/sessions', label: 'sessions' },
  { href: '/dashboard/auth/keys', label: 'keys' },
  { href: '/dashboard/auth/domains', label: 'domains' },
] as const;

export function AuthSectionNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Briven Auth sections"
      className="flex gap-1 overflow-x-auto border-b pb-px [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ borderColor: 'var(--auth-accent-border, var(--color-border-subtle))' }}
    >
      {TABS.map((tab) => {
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
                style={{ background: 'var(--auth-accent, #e6b800)' }}
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
