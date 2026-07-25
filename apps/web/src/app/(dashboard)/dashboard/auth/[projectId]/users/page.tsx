import Link from 'next/link';

import { fetchAuthUsers } from '../../lib/auth-api';

export const metadata = { title: 'Auth · users' };
export const dynamic = 'force-dynamic';

function statusLabel(status?: string): string {
  if (status === 'held') return 'on hold';
  if (status === 'archived') return 'archived';
  return 'active';
}

function statusColor(status?: string): string {
  if (status === 'held') return 'var(--auth-accent, #FFFD74)';
  if (status === 'archived') return 'var(--color-text-muted)';
  return 'var(--color-text-muted)';
}

export default async function AuthProjectUsersPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const result = await fetchAuthUsers(100, projectId);

  return (
    <section>
      <header className="mb-6">
        <h2 className="font-mono text-lg tracking-tight text-[var(--color-text)]">
          users
        </h2>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          app end-users for this project · click a row to manage access
        </p>
      </header>

      {!result.ok ? (
        <div className="rounded-md border border-dashed border-[var(--color-border)] p-8 font-mono text-sm text-[var(--color-text-muted)]">
          {result.status === 401
            ? 'sign in to briven.tech to see users'
            : result.message || 'could not load users'}
        </div>
      ) : result.users.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--color-border)] p-8 font-mono text-sm text-[var(--color-text-muted)]">
          no users for this project yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
          <table className="w-full min-w-[640px] text-left font-mono text-xs">
            <thead className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2 font-normal">email / phone</th>
                <th className="px-3 py-2 font-normal">status</th>
                <th className="px-3 py-2 font-normal">joined</th>
                <th className="px-3 py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {result.users.map((u) => {
                const status =
                  'status' in u && typeof u.status === 'string'
                    ? u.status
                    : 'active';
                return (
                  <tr
                    key={u.id}
                    className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-surface)]"
                  >
                    <td className="px-3 py-2 text-[var(--color-text)]">
                      <Link
                        href={`/dashboard/auth/${encodeURIComponent(projectId)}/users/${encodeURIComponent(u.id)}`}
                        className="hover:underline"
                      >
                        {u.emails[0] ?? u.phoneNumbers[0] ?? '—'}
                      </Link>
                      <span className="mt-0.5 block max-w-[14rem] truncate text-[10px] text-[var(--color-text-subtle)]">
                        {u.id}
                      </span>
                    </td>
                    <td
                      className="px-3 py-2"
                      style={{ color: statusColor(status) }}
                    >
                      {statusLabel(status)}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-muted)]">
                      {u.timeJoined
                        ? new Date(u.timeJoined).toLocaleString()
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/dashboard/auth/${encodeURIComponent(projectId)}/users/${encodeURIComponent(u.id)}`}
                        className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                      >
                        manage →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-[var(--color-border-subtle)] px-3 py-2 font-mono text-[10px] text-[var(--color-text-muted)]">
            {result.users.length} users · this project
          </p>
        </div>
      )}
    </section>
  );
}
