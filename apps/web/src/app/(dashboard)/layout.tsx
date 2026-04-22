import Image from 'next/image';
import Link from 'next/link';

import { SignOutButton } from './sign-out-button.js';
import { requireUser } from '../../lib/session.js';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-dvh bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="border-b border-[var(--color-border-subtle)]">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="flex items-center gap-3" aria-label="briven dashboard">
            <Image src="/icon.svg" alt="" width={24} height={24} priority />
            <span className="font-mono text-sm">briven</span>
            <span className="font-mono text-xs text-[var(--color-text-subtle)]">· cloud</span>
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

      <div className="mx-auto grid w-full max-w-6xl grid-cols-[180px_1fr] gap-8 px-6 py-8">
        <nav aria-label="dashboard sections" className="flex flex-col gap-1 font-mono text-sm">
          <Link
            href="/dashboard/projects"
            className="rounded-md px-3 py-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
          >
            projects
          </Link>
          <Link
            href="/dashboard/settings"
            className="rounded-md px-3 py-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
          >
            settings
          </Link>
        </nav>

        <main>{children}</main>
      </div>
    </div>
  );
}
