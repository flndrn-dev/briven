import Image from 'next/image';
import Link from 'next/link';

import { LandingUserMenu } from '../landing-user-menu';

interface SiteHeaderUser {
  name: string | null;
  email: string;
  image: string | null;
  legalName: string | null;
}

export function SiteHeader({ user }: { user: SiteHeaderUser | null }) {
  return (
    <header className="relative z-50 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
      <Link href="/" className="flex items-center gap-2" aria-label="briven home">
        <Image src="/icon.svg" alt="" width={40} height={40} priority className="opacity-95" />
        <span className="font-mono tracking-tight text-[var(--color-text)] text-[var(--text-small)]">
          briven
        </span>
        <span className="hidden font-mono text-[var(--color-text-subtle)] text-[var(--text-xs)] sm:inline">
          · tech
        </span>
        <span
          aria-label="live"
          title="Briven hosted platform — production"
          className="ml-1 inline-flex items-center rounded-[var(--radius-full)] border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] px-1.5 py-0.5 font-mono uppercase tracking-wider text-[var(--color-primary)] text-[10px]"
        >
          live
        </span>
      </Link>

      <nav className="flex items-center gap-6 font-mono text-[var(--text-small)]">
        <Link
          href="/pricing"
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          pricing
        </Link>
        <Link
          href="/compare"
          className="hidden text-[var(--color-text-muted)] hover:text-[var(--color-text)] sm:inline"
        >
          compare
        </Link>
        <Link
          href="/migrate"
          className="hidden text-[var(--color-text-muted)] hover:text-[var(--color-text)] sm:inline"
        >
          migrate
        </Link>
        <Link
          href="https://docs.briven.tech"
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          docs
        </Link>
        {user ? (
          <LandingUserMenu user={user} />
        ) : (
          <Link
            href="/signin"
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            sign in
          </Link>
        )}
      </nav>
    </header>
  );
}
