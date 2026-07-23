import { fetchAuthUsers } from '../../lib/auth-api';

export const metadata = { title: 'Auth · users' };
export const dynamic = 'force-dynamic';

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
          app end-users for this project only
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
                <th className="px-3 py-2 font-normal">user id</th>
                <th className="px-3 py-2 font-normal">joined</th>
              </tr>
            </thead>
            <tbody>
              {result.users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-[var(--color-border-subtle)] last:border-0"
                >
                  <td className="px-3 py-2 text-[var(--color-text)]">
                    {u.emails[0] ?? u.phoneNumbers[0] ?? '—'}
                  </td>
                  <td className="max-w-[12rem] truncate px-3 py-2 text-[var(--color-text-muted)]">
                    {u.id}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {u.timeJoined
                      ? new Date(u.timeJoined).toLocaleString()
                      : '—'}
                  </td>
                </tr>
              ))}
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
