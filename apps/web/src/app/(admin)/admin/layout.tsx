import Image from 'next/image';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { UserMenuButton } from '@/components/user-menu-button';
import { getSessionUser } from '@/lib/session';

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
          {/* Same dropdown as the user dashboard — lets the super admin pivot
              between admin ↔ user dashboard ↔ website ↔ docs, and sign out.
              variant="admin" swaps the first row to a "dashboard" link;
              placement="down" opens it below this top header. */}
          <div className="w-56">
            <UserMenuButton
              user={{
                name: user.name,
                email: user.email,
                image: user.image,
                legalName: user.legalName,
              }}
              collapsed={false}
              isAdmin={user.isAdmin}
              placement="down"
              variant="admin"
            />
          </div>
        </div>
      </header>

      <CockpitMobileNav />

      <div className="flex min-h-0 flex-1">
        <CockpitNav />
        {/* Command-deck spacing: generous padding and a wide-but-bounded
            content column so dashboards breathe on big monitors without
            stretching into unreadable line lengths. */}
        <main className="min-w-0 flex-1 overflow-y-auto p-6 md:p-8 lg:p-10">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
