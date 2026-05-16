import Image from 'next/image';
import Link from 'next/link';

import { DashboardMobileNav } from './dashboard-mobile-nav';
import { DashboardSidebar } from './dashboard-sidebar';
import { SignOutButton } from './sign-out-button';
import { LiveRefresh } from '../../components/live-refresh';
import { apiJson } from '../../lib/api';
import { requireUser } from '../../lib/session';

interface BuildInfo {
  buildSha: string;
  buildAt: string;
}

async function fetchBuildInfo(): Promise<BuildInfo | null> {
  // /info is unauthenticated + cheap. If it ever fails (dev mode,
  // old deploy), suppress — the footer just doesn't render the sha.
  try {
    return await apiJson<BuildInfo>('/info');
  } catch {
    return null;
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, info] = await Promise.all([requireUser(), fetchBuildInfo()]);

  return (
    <div className="flex h-dvh flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      <LiveRefresh />
      <header className="shrink-0 border-b border-[var(--color-border-subtle)]">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="flex items-center gap-3" aria-label="briven dashboard">
            <Image src="/icon.svg" alt="" width={24} height={24} priority />
            <span className="font-mono text-sm">briven</span>
            <span className="font-mono text-xs text-[var(--color-text-subtle)]">· tech</span>
            <span
              aria-label="beta v1"
              title="briven is in public beta — production-ready, on track for GA later this year"
              className="ml-1 inline-flex items-center rounded-[var(--radius-full)] border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-primary)]"
            >
              beta v1
            </span>
          </Link>

          <div className="flex items-center gap-4">
            <span
              className="font-mono text-xs text-[var(--color-text-muted)]"
              title={user.email}
              aria-label="signed in user"
            >
              {/* Per CLAUDE.md §5.1 avoid showing full email; prefer name fallback. */}
              {user.name ?? 'signed in'}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Mobile-only nav row. Hidden md+ where the sidebar takes over. */}
      <DashboardMobileNav isAdmin={user.isAdmin} />

      {/* Body area fills the remaining viewport height. Sidebar spans the
          full body height; main scrolls independently so the sidebar's
          bottom-anchored toggle stays put. Padding tightens on mobile so
          the main content gets the full viewport width. */}
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 gap-4 px-4 py-4 md:gap-8 md:px-6 md:py-8">
        <DashboardSidebar
          isAdmin={user.isAdmin}
          user={{
            name: user.name,
            email: user.email,
            image: user.image,
            legalName: user.legalName,
          }}
        />
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      <footer className="shrink-0 border-t border-[var(--color-border-subtle)]">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-2 font-mono text-[10px] text-[var(--color-text-subtle)]">
          <span>
            built with <span className="text-[#e8344a]">♥</span> in Flanders
            <span className="ml-3">flndrn Limited, Limassol, Cyprus</span>
          </span>
          <div className="flex items-center gap-3">
            <Link href="https://docs.briven.tech" className="hover:text-[var(--color-text-muted)]">
              docs
            </Link>
            <Link
              href="https://docs.briven.tech/support"
              className="hover:text-[var(--color-text-muted)]"
            >
              support
            </Link>
            <Link
              href="https://docs.briven.tech/status"
              className="hover:text-[var(--color-text-muted)]"
            >
              status
            </Link>
            {info ? (
              <span title={`built ${info.buildAt}`}>build {info.buildSha.slice(0, 7)}</span>
            ) : null}
          </div>
        </div>
      </footer>
    </div>
  );
}
