import Link from 'next/link';

import { apiJson } from '../../../../lib/api';
import { requireUser } from '../../../../lib/session';

interface PendingInvitation {
  id: string;
  projectId: string;
  role: string;
  invitedBy: string | null;
  expiresAt: string;
}

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireUser();

  const { invitations } = await apiJson<{ invitations: PendingInvitation[] }>(
    '/v1/me/invitations',
  ).catch(() => ({ invitations: [] as PendingInvitation[] }));

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <section>
        <h2 className="font-mono text-sm text-[var(--color-text)]">account</h2>
        <dl className="mt-3 grid grid-cols-[140px_1fr] gap-y-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5 font-mono text-sm">
          <dt className="text-[var(--color-text-subtle)]">email</dt>
          <dd>{user.email}</dd>

          <dt className="text-[var(--color-text-subtle)]">name</dt>
          <dd>{user.name ?? '—'}</dd>

          <dt className="text-[var(--color-text-subtle)]">user id</dt>
          <dd className="text-xs">{user.id}</dd>

          <dt className="text-[var(--color-text-subtle)]">email verified</dt>
          <dd>{user.emailVerified ? 'yes' : 'no'}</dd>

          {user.isAdmin ? (
            <>
              <dt className="text-[var(--color-text-subtle)]">role</dt>
              <dd>
                <span className="rounded bg-[var(--color-primary-subtle)] px-2 py-0.5 text-xs text-[var(--color-primary)]">
                  platform admin
                </span>
                <Link
                  href="/dashboard/admin"
                  className="ml-3 text-[var(--color-text-link)] hover:underline"
                >
                  open admin →
                </Link>
              </dd>
            </>
          ) : null}
        </dl>
      </section>

      <section>
        <h2 className="font-mono text-sm text-[var(--color-text)]">pending invitations</h2>
        {invitations.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-[var(--color-border)] p-6 text-center font-mono text-sm text-[var(--color-text-muted)]">
            no pending invitations.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {invitations.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 font-mono text-sm"
              >
                <div>
                  <p>
                    invited to <code>{inv.projectId}</code> as{' '}
                    <span className="text-[var(--color-primary)]">{inv.role}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                    expires {new Date(inv.expiresAt).toISOString().slice(0, 10)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-mono text-sm text-red-400">danger zone</h2>
        <div className="mt-3 rounded-md border border-red-400/30 bg-red-400/5 p-5 font-mono text-sm">
          <p>account deletion arrives in phase 3. use <code>briven cli export</code> first.</p>
        </div>
      </section>
    </div>
  );
}
