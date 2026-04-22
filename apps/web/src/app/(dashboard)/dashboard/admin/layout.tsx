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
      </nav>
      <section>{children}</section>
    </div>
  );
}
