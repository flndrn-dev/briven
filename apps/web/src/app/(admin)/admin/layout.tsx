import Image from 'next/image';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/session';

import { AdminSignOut } from './admin-sign-out';
import { CockpitMobileNav } from './cockpit-mobile-nav';
import { CockpitNav } from './cockpit-nav';

export const metadata = {
  title: 'admin',
  // Explicit briven favicon on the admin cockpit pages (don't rely on
  // inherited metadata — these live in a separate route group).
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    shortcut: '/favicon.svg',
  },
};

/**
 * Superadmin cockpit shell + gate.
 *
 * Gate: reuses the existing Better Auth session via getSessionUser()
 * (apps/api /v1/me, cookies forwarded by apiFetch). An unauthenticated
 * visitor is sent to /admin/login; a signed-in non-admin gets notFound()
 * — the same contract the former /dashboard/admin layout used before the
 * admin pages were consolidated into this cockpit route group.
 *
 * The login page lives in a SEPARATE route group ((admin-auth)) so it is
 * NOT wrapped by this layout — that is what prevents a redirect loop when
 * an unauthenticated user lands on /admin/login.
 */
export default async function AdminCockpitLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/admin/login');
  if (!user.isAdmin) notFound();

  return (
    <div className="flex h-dvh flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="shrink-0 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center justify-between px-6 py-4">
          <Link href="/admin" className="flex items-center gap-3" aria-label="briven admin">
            <Image src="/icon.svg" alt="" width={24} height={24} priority />
            <span className="font-mono text-sm">briven admin</span>
          </Link>
          <div className="flex items-center gap-4">
            <span
              className="hidden font-mono text-xs text-[var(--color-text-subtle)] sm:inline"
              aria-label="signed in operator"
            >
              {/* No email shown — name fallback only (hard rule). */}
              {user.name ?? 'operator'}
            </span>
            <AdminSignOut />
          </div>
        </div>
      </header>

      <CockpitMobileNav />

      <div className="flex min-h-0 flex-1">
        <CockpitNav />
        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
