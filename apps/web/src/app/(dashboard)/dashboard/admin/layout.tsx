import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireUser } from '../../../../lib/session';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!user.isAdmin) notFound();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-mono text-xl tracking-tight">admin</h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          platform super-admin view. every action is audit-logged.
        </p>
      </header>
      <nav className="flex gap-1 border-b border-[var(--color-border-subtle)]">
        <Link
          href="/dashboard/admin"
          className="px-3 py-2 font-mono text-sm text-[var(--color-text)]"
        >
          stats
        </Link>
        <Link
          href="/dashboard/admin/users"
          className="px-3 py-2 font-mono text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          users
        </Link>
        <Link
          href="/dashboard/admin/projects"
          className="px-3 py-2 font-mono text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          projects
        </Link>
        <Link
          href="/dashboard/admin/abuse-reports"
          className="px-3 py-2 font-mono text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          abuse reports
        </Link>
        <Link
          href="/dashboard/admin/email-events"
          className="px-3 py-2 font-mono text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          email events
        </Link>
        <Link
          href="/dashboard/admin/email-suppressions"
          className="px-3 py-2 font-mono text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          suppressions
        </Link>
        <Link
          href="/dashboard/admin/deploys"
          className="px-3 py-2 font-mono text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          deploys
        </Link>
        <Link
          href="/dashboard/admin/usage"
          className="px-3 py-2 font-mono text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          usage
        </Link>
        <Link
          href="/dashboard/admin/realtime"
          className="px-3 py-2 font-mono text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          realtime
        </Link>
        <Link
          href="/dashboard/admin/allowlist"
          className="px-3 py-2 font-mono text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          allowlist
        </Link>
      </nav>
      <section>{children}</section>
    </div>
  );
}
